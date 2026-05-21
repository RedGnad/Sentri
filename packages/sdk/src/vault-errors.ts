// Custom-error decoder for the Sentri on-chain stack.
//
// Solidity custom errors revert with a 4-byte selector = keccak256("Name(types)")
// truncated to 4 bytes. ethers surfaces this as opaque `data` (e.g. "0x4c0f9589")
// which prints as `execution reverted (unknown custom error)`. This module maps
// each known selector back to a name + operator-facing explanation.
//
// Selectors are COMPUTED at module load from the error signature
// (ethers.id("Name()").slice(0, 10)) — never hardcoded — so they stay correct
// if a signature ever changes. Every Sentri custom error is parameterless, so
// the selector is keccak256("Name()")[:4].
//
// Sources: contracts/src/TreasuryVault.sol, AgentINFT.sol,
//          SentriSwapRouter.sol, JaineV3PoolAdapter.sol, SentriPriceFeed.sol

import { ethers } from "ethers";

interface VaultErrorSpec {
  name: string;
  /** Operator-facing explanation of what the revert means. */
  message: string;
}

const ERROR_CATALOGUE: readonly VaultErrorSpec[] = [
  {
    name: "InvalidTEESignature",
    message: "recovered TEE signer is not bound to the active AgentINFT.",
  },
  { name: "NotAgent", message: "caller is not the vault's configured agent." },
  {
    name: "AgentNotVerified",
    message: "agent does not hold an active (non-revoked) AgentINFT.",
  },
  {
    name: "AgentNotAuthorizedForVault",
    message: "agent's AgentINFT is not authorized for this vault.",
  },
  {
    name: "CooldownNotElapsed",
    message: "cooldown period since the last execution has not elapsed.",
  },
  {
    name: "AllocationExceeded",
    message: "post-trade risk exposure would exceed policy.maxAllocationBps.",
  },
  {
    name: "DrawdownBreached",
    message:
      "post-trade TVL would breach policy.maxDrawdownBps below the high-water mark.",
  },
  {
    name: "PriceStale",
    message:
      "oracle price is non-positive or older than policy.maxPriceStaleness.",
  },
  {
    name: "InsufficientAmountOut",
    message: "swap output fell below the slippage-protected minimum.",
  },
  {
    name: "IntentAlreadyUsed",
    message: "this intentHash has already been executed (replay blocked).",
  },
  {
    name: "ResponseAlreadyUsed",
    message: "this TEE responseHash has already been executed (replay blocked).",
  },
  { name: "ExpiredIntent", message: "the intent deadline has already passed." },
  { name: "VaultKilled", message: "the vault kill-switch is engaged." },
  {
    name: "ZeroAmount",
    message:
      "amount is zero, or the vault base balance is below the requested allocation.",
  },
  {
    name: "ZeroAddress",
    message: "a zero address was supplied where a contract/EOA is required.",
  },
  {
    name: "InsufficientRiskBalance",
    message: "vault risk-token balance is below the requested deleverage amount.",
  },
  {
    name: "InvalidPolicy",
    message: "policy parameters are outside the contract's accepted bounds.",
  },
  { name: "NotFactory", message: "caller is not the VaultFactory." },
];

export interface DecodedVaultError {
  /** 4-byte selector, lowercase, 0x-prefixed (10 chars). */
  selector: string;
  name: string;
  /** Operator-facing explanation. */
  message: string;
}

const SELECTOR_TO_ERROR: ReadonlyMap<string, DecodedVaultError> = new Map(
  ERROR_CATALOGUE.map((spec) => {
    const selector = ethers.id(`${spec.name}()`).slice(0, 10).toLowerCase();
    return [selector, { selector, name: spec.name, message: spec.message }];
  }),
);

/**
 * Pull a 4-byte custom-error selector out of any error shape ethers may throw:
 * a raw "0x…" string, an error object with `.data`, a nested provider error
 * (`.info.error.data` / `.error.data`), or — as a last resort — the message text.
 */
export function extractErrorSelector(err: unknown): string | null {
  const candidates: unknown[] = [];
  if (typeof err === "string") candidates.push(err);
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    candidates.push(e.data); // ethers v6 puts raw revert data here
    if (e.info && typeof e.info === "object") {
      const info = e.info as Record<string, unknown>;
      if (info.error && typeof info.error === "object") {
        candidates.push((info.error as Record<string, unknown>).data);
      }
    }
    if (e.error && typeof e.error === "object") {
      candidates.push((e.error as Record<string, unknown>).data);
    }
    if (typeof e.message === "string") candidates.push(e.message);
  }
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const match = candidate.match(/0x[0-9a-fA-F]{8}/);
    if (match) return match[0].slice(0, 10).toLowerCase();
  }
  return null;
}

/**
 * Decode a Sentri custom-error revert. Accepts either a bare selector string
 * ("0x4c0f9589") or any error object/string that carries revert data.
 * Returns `null` for selectors not in the catalogue.
 */
export function decodeVaultError(err: unknown): DecodedVaultError | null {
  let selector: string | null;
  if (typeof err === "string" && /^\s*0x[0-9a-fA-F]{8}\s*$/.test(err)) {
    selector = err.trim().toLowerCase();
  } else {
    selector = extractErrorSelector(err);
  }
  if (!selector) return null;
  return SELECTOR_TO_ERROR.get(selector) ?? null;
}
