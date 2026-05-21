// TEE-signer preflight + health check for the Sentri agent runner.
//
// Why this exists
// ───────────────
// TreasuryVault.executeStrategy → _verifyTEE recovers the TEE signer from the
// signed response and requires:
//
//     agentNFT.isActiveAgentWithSigner(msg.sender, teeSigner)  // else InvalidTEESignature
//
// If the 0G Sealed Inference provider's TEE signer is NOT bound to the agent's
// active AgentINFT, the transaction reverts on-chain with the custom error
// InvalidTEESignature (selector 0x4c0f9589) — surfaced by ethers as an opaque
// "execution reverted (unknown custom error)".
//
// The functions below run the SAME gate read-only, BEFORE estimateGas /
// executeStrategy, so a signer mismatch becomes a clean, operator-actionable
// skip instead of a wasted, opaque on-chain revert. They never send a
// transaction — funds are never at risk.
//
// This module deliberately does NOT weaken or bypass any on-chain check: the
// vault's InvalidTEESignature guard remains the source of truth. The preflight
// only mirrors it off-chain for a better operator signal.
//
// Notes
// - The gate `isActiveAgentWithSigner(agent, signer)` keys on the AGENT
//   ADDRESS, not a token id — so the preflight verdict never depends on
//   resolving a token id. The token id is only used for the informational
//   expected-signer lookup.
// - The expected signer is read via the `agentMetadata` public mapping getter,
//   which exists on every deployed AgentINFT version. The v2-only
//   `intelligentDataOf` convenience view is intentionally not used: it reverts
//   on the pre-v2 Galileo deployment.

import { ethers } from "ethers";
import { AGENT_INFT_ABI, CHAIN, CONTRACTS, VAULT_FACTORY_ABI } from "./constants.js";

/** Subset of AgentINFT.agentMetadata(tokenId) the runner cares about. */
export interface AgentMetadataView {
  provider: string;
  teeSignerAddress: string;
  revoked: boolean;
  metadataRootHash: string;
}

/** Result of the read-only preflight performed before each executeStrategy. */
export interface PreflightResult {
  /** True when isActiveAgentWithSigner(agent, recoveredSigner) is true on-chain. */
  ok: boolean;
  agentAddress: string;
  agentNFTAddress: string;
  /** Agent INFT token id, or "unknown" if it could not be resolved. */
  agentTokenId: string;
  /** Signer recovered from the TEE-signed response (what the vault will recover). */
  recoveredSigner: string;
  /** teeSignerAddress currently recorded in the AgentINFT (agentMetadata). */
  expectedSigner: string;
}

/** Full signer health snapshot — used by the CLI diagnostic. */
export interface SignerHealth {
  agentAddress: string;
  agentNFTAddress: string;
  agentTokenId: string;
  /** teeSignerAddress recorded on-chain in the AgentINFT. */
  expectedSigner: string;
  /** Provider string recorded on-chain in the AgentINFT. */
  provider: string;
  /** 0G Storage metadata root recorded on-chain in the AgentINFT. */
  metadataRootHash: string;
  /** Signer recovered from the latest TEE response, if supplied. */
  recoveredSigner: string | null;
  /** True if the agent holds an active (non-revoked) AgentINFT. */
  isActiveAgent: boolean;
  /** True if isActiveAgentWithSigner(agent, recoveredSigner) is true on-chain. */
  match: boolean;
}

/** Read the AgentINFT metadata struct for a token id via the `agentMetadata` getter. */
export async function readAgentMetadata(
  agentNFT: ethers.Contract,
  tokenId: bigint,
): Promise<AgentMetadataView> {
  const meta = await agentNFT.agentMetadata(tokenId);
  // The getter returns (enclaveHash, attestationHash, provider, teeSignerAddress,
  // issuedAt, revoked, metadataRootHash) — accessed here by name.
  return {
    provider: String(meta.provider),
    teeSignerAddress: String(meta.teeSignerAddress),
    revoked: Boolean(meta.revoked),
    metadataRootHash: String(meta.metadataRootHash),
  };
}

/**
 * Resolve the agent's AgentINFT token id directly from the AgentINFT contract.
 *
 * Used when the deployed VaultFactory predates the `agentTokenId()` getter.
 * AgentINFT mints sequential ids from 0 and never burns, so a linear scan over
 * `totalSupply()` is exact and cheap (typically 1 token). A non-revoked token
 * is preferred; otherwise the first token the agent owns is returned.
 *
 * @returns the token id, or `null` if the agent owns no AgentINFT.
 */
export async function resolveAgentTokenId(
  agentNFT: ethers.Contract,
  agentAddress: string,
): Promise<bigint | null> {
  const supply: bigint = await agentNFT.totalSupply();
  const target = agentAddress.toLowerCase();
  let firstOwned: bigint | null = null;
  for (let id = 0n; id < supply; id++) {
    let owner: string;
    try {
      owner = await agentNFT.ownerOf(id);
    } catch {
      continue; // defensive — AgentINFT has no burn, but stay safe
    }
    if (owner.toLowerCase() !== target) continue;
    if (firstOwned === null) firstOwned = id;
    try {
      const meta = await readAgentMetadata(agentNFT, id);
      if (!meta.revoked) return id; // prefer an active token
    } catch {
      // fall through — return firstOwned below
    }
  }
  return firstOwned;
}

/**
 * Read-only preflight of the vault's InvalidTEESignature guard.
 *
 * @param agentNFT        AgentINFT contract handle (read-only is enough).
 * @param agentAddress    Agent wallet — the `msg.sender` of executeStrategy.
 * @param agentNFTAddress AgentINFT contract address (for logging).
 * @param agentTokenId    Agent's INFT token id, or `null` if unresolved. Used
 *                        only for the informational expected-signer lookup;
 *                        the `ok` verdict never depends on it.
 * @param recoveredSigner Signer recovered off-chain from the TEE-signed response.
 */
export async function preflightTeeSigner(
  agentNFT: ethers.Contract,
  agentAddress: string,
  agentNFTAddress: string,
  agentTokenId: bigint | null,
  recoveredSigner: string,
): Promise<PreflightResult> {
  // The gating call — mirrors TreasuryVault._verifyTEE exactly. A transient RPC
  // failure here is intentionally allowed to throw: better a retried cycle than
  // a doomed transaction sent on stale assumptions.
  const ok: boolean = await agentNFT.isActiveAgentWithSigner(agentAddress, recoveredSigner);

  // The expected signer is only needed for the operator log; if this read fails
  // (or the token id is unknown) the preflight verdict still stands.
  let expectedSigner = "unavailable";
  if (agentTokenId !== null) {
    try {
      const meta = await readAgentMetadata(agentNFT, agentTokenId);
      expectedSigner = meta.teeSignerAddress;
    } catch {
      // Leave expectedSigner as "unavailable" — the `ok` verdict is unaffected.
    }
  }

  return {
    ok,
    agentAddress,
    agentNFTAddress,
    agentTokenId: agentTokenId === null ? "unknown" : agentTokenId.toString(),
    recoveredSigner,
    expectedSigner,
  };
}

/**
 * Fetch a complete signer health snapshot. Pure read-only: safe to run from a
 * CLI with no private key.
 */
export async function fetchSignerHealth(opts: {
  provider: ethers.Provider;
  agentNFTAddress: string;
  agentAddress: string;
  agentTokenId: bigint | null;
  recoveredSigner?: string | null;
}): Promise<SignerHealth> {
  const agentNFT = new ethers.Contract(opts.agentNFTAddress, AGENT_INFT_ABI, opts.provider);

  let expectedSigner = "unavailable";
  let provider = "unavailable";
  let metadataRootHash = "unavailable";
  if (opts.agentTokenId !== null) {
    const meta = await readAgentMetadata(agentNFT, opts.agentTokenId);
    expectedSigner = meta.teeSignerAddress;
    provider = meta.provider;
    metadataRootHash = meta.metadataRootHash;
  }

  const isActiveAgent: boolean = await agentNFT.isActiveAgent(opts.agentAddress);

  let match = false;
  if (opts.recoveredSigner) {
    match = await agentNFT.isActiveAgentWithSigner(opts.agentAddress, opts.recoveredSigner);
  }

  return {
    agentAddress: opts.agentAddress,
    agentNFTAddress: opts.agentNFTAddress,
    agentTokenId: opts.agentTokenId === null ? "unknown" : opts.agentTokenId.toString(),
    expectedSigner,
    provider,
    metadataRootHash,
    recoveredSigner: opts.recoveredSigner ?? null,
    isActiveAgent,
    match,
  };
}

/**
 * Resolve the agent address + AgentINFT address + INFT token id.
 *
 * The VaultFactory `agent` / `agentNFT` immutables are the authoritative source
 * for the first two. For the token id, the factory's `agentTokenId()` getter is
 * tried first; deployed factories that predate that getter fall back to a scan
 * of the AgentINFT (`resolveAgentTokenId`). No address is ever invented.
 */
export async function resolveAgentIdentity(opts: {
  provider: ethers.Provider;
  factoryAddress?: string;
  agentNFTAddress?: string;
  agentAddress?: string;
  agentTokenId?: string;
}): Promise<{
  factoryAddress: string;
  agentNFTAddress: string;
  agentAddress: string;
  agentTokenId: bigint | null;
}> {
  const factoryAddress = opts.factoryAddress ?? CONTRACTS.vaultFactory;
  const factory = new ethers.Contract(factoryAddress, VAULT_FACTORY_ABI, opts.provider);

  const agentNFTAddress = opts.agentNFTAddress ?? ((await factory.agentNFT()) as string);
  const agentAddress = opts.agentAddress ?? ((await factory.agent()) as string);

  let agentTokenId: bigint | null;
  if (opts.agentTokenId !== undefined) {
    agentTokenId = BigInt(opts.agentTokenId);
  } else {
    try {
      agentTokenId = (await factory.agentTokenId()) as bigint;
    } catch {
      const agentNFT = new ethers.Contract(agentNFTAddress, AGENT_INFT_ABI, opts.provider);
      agentTokenId = await resolveAgentTokenId(agentNFT, agentAddress);
    }
  }

  return { factoryAddress, agentNFTAddress, agentAddress, agentTokenId };
}

/** Default RPC URL (galileo/mainnet selected by SENTRI_NETWORK in constants). */
export const DEFAULT_RPC_URL = CHAIN.rpcUrl;
