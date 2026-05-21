// Tests for describeOutcome — the skip/execute → human-verdict mapping.
//
// Run:  pnpm --filter @steward/sdk test

import test from "node:test";
import assert from "node:assert/strict";
import { describeOutcome } from "./outcome-verdict.js";

test("executed → ok verdict naming the action", () => {
  const v = describeOutcome({ status: "executed", action: "Rebalance" });
  assert.equal(v.tone, "ok");
  assert.match(v.text, /Executed/);
  assert.match(v.text, /Rebalance/);
});

test("dust skip → 'Defensive hold', tone ok (not an error)", () => {
  const v = describeOutcome({
    status: "skipped",
    reason: "risk position below dust threshold (0.001 USDC)",
  });
  assert.equal(v.tone, "ok");
  assert.match(v.text, /Defensive hold/);
  assert.match(v.text, /nothing left to sell|Nothing left to sell/i);
});

test("headroom skip → 'Target reached'", () => {
  const v = describeOutcome({
    status: "skipped",
    reason: "no remaining ETH exposure headroom",
  });
  assert.equal(v.tone, "ok");
  assert.match(v.text, /Target reached/);
});

test("cooldown skip → waiting tone", () => {
  const v = describeOutcome({ status: "skipped", reason: "cooldown not elapsed" });
  assert.equal(v.tone, "waiting");
  assert.match(v.text, /Cooldown/);
});

test("deterministic hold → ok tone", () => {
  const v = describeOutcome({ status: "skipped", reason: "no action needed (deterministic hold)" });
  assert.equal(v.tone, "ok");
  assert.match(v.text, /Holding/);
});

test("TEE signer mismatch skip → blocked tone", () => {
  const v = describeOutcome({
    status: "skipped",
    reason: "TEE signer not bound to active AgentINFT — operator action required (SKIPPED_TEE_SIGNER_MISMATCH)",
  });
  assert.equal(v.tone, "blocked");
  assert.match(v.text, /Auto-execution blocked/);
});

test("killed → blocked tone, mentions funds safe", () => {
  const v = describeOutcome({ status: "killed", reason: "vault killed mid-iteration" });
  assert.equal(v.tone, "blocked");
  assert.match(v.text, /Kill-switch/);
});

test("inference funding error → waiting tone", () => {
  const v = describeOutcome({ status: "error", reason: "InsufficientAvailableBalance: please add more funds" });
  assert.equal(v.tone, "waiting");
});

test("unknown skip reason falls back to the raw reason (nothing hidden)", () => {
  const v = describeOutcome({ status: "skipped", reason: "some brand new reason" });
  assert.equal(v.text, "some brand new reason");
});
