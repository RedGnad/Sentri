// Unit tests for the TEE-signer hotfix: custom-error decoding + preflight gate.
//
// Run:  pnpm --filter @steward/sdk test
//   (node:test runner via tsx — no extra test framework added)

import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { decodeVaultError, extractErrorSelector } from "./vault-errors.js";
import { preflightTeeSigner } from "./agent-signer.js";

const AGENT = "0x0000000000000000000000000000000000000A11";
const NFT = "0x00000000000000000000000000000000000000FF";
const SIGNER = "0x03716ddFbA77600C33b605FABD2F70Fe89856b0d";
const ZERO32 = "0x" + "00".repeat(32);

// ── error decoder ─────────────────────────────────────────────────────────

test("0x4c0f9589 is the InvalidTEESignature() selector", () => {
  assert.equal(ethers.id("InvalidTEESignature()").slice(0, 10), "0x4c0f9589");
});

test("decodeVaultError maps 0x4c0f9589 to InvalidTEESignature", () => {
  const decoded = decodeVaultError("0x4c0f9589");
  assert.ok(decoded, "expected a decoded error");
  assert.equal(decoded.name, "InvalidTEESignature");
  assert.match(decoded.message, /not bound to the active AgentINFT/);
});

test("decodeVaultError extracts the selector from an ethers error object", () => {
  // Shape mirrors the reported failure: data="0x4c0f9589".
  const decoded = decodeVaultError({ code: "CALL_EXCEPTION", data: "0x4c0f9589" });
  assert.equal(decoded?.name, "InvalidTEESignature");
});

test("decodeVaultError reads a nested provider error", () => {
  const decoded = decodeVaultError({ info: { error: { data: "0x4c0f9589" } } });
  assert.equal(decoded?.name, "InvalidTEESignature");
});

test("decodeVaultError handles other known Sentri custom errors", () => {
  assert.equal(decodeVaultError("0xa22b745e")?.name, "CooldownNotElapsed");
  assert.equal(decodeVaultError("0x74a5d1f5")?.name, "AllocationExceeded");
  assert.equal(decodeVaultError("0x897b3413")?.name, "DrawdownBreached");
  assert.equal(decodeVaultError("0xe52970aa")?.name, "InsufficientAmountOut");
});

test("decodeVaultError returns null for an unknown selector", () => {
  assert.equal(decodeVaultError("0xdeadbeef"), null);
  assert.equal(extractErrorSelector({}), null);
});

// ── preflight gate ────────────────────────────────────────────────────────

/** Minimal duck-typed AgentINFT stand-in for the preflight read calls. */
function fakeAgentNFT(isActive: boolean, onchainSigner: string): ethers.Contract {
  return {
    isActiveAgentWithSigner: async () => isActive,
    agentMetadata: async () => ({
      enclaveHash: ZERO32,
      attestationHash: ZERO32,
      provider: "0G Sealed Inference",
      teeSignerAddress: onchainSigner,
      issuedAt: 0n,
      revoked: false,
      metadataRootHash: ZERO32,
    }),
  } as unknown as ethers.Contract;
}

test("preflight FALSE → not ok (executeStrategy must be skipped)", async () => {
  // Recovered signer is NOT bound to the AgentINFT — the reported bug.
  const result = await preflightTeeSigner(
    fakeAgentNFT(false, ethers.ZeroAddress),
    AGENT,
    NFT,
    0n,
    SIGNER,
  );
  assert.equal(result.ok, false, "preflight must fail → caller skips executeStrategy");
  assert.equal(result.recoveredSigner, SIGNER);
});

test("preflight TRUE → ok (execution path may continue)", async () => {
  const result = await preflightTeeSigner(
    fakeAgentNFT(true, SIGNER),
    AGENT,
    NFT,
    0n,
    SIGNER,
  );
  assert.equal(result.ok, true, "preflight must pass → existing behaviour unchanged");
  assert.equal(result.expectedSigner, SIGNER);
});

test("preflight verdict survives an agentMetadata read failure", async () => {
  const flakyNFT = {
    isActiveAgentWithSigner: async () => false,
    agentMetadata: async () => {
      throw new Error("RPC hiccup");
    },
  } as unknown as ethers.Contract;
  const result = await preflightTeeSigner(flakyNFT, AGENT, NFT, 0n, SIGNER);
  assert.equal(result.ok, false);
  assert.equal(result.expectedSigner, "unavailable");
});
