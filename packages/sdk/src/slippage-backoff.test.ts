// Tests for the per-vault slippage backoff helpers — the process-local state
// that holds a risk buy after it reverts on the pool's on-chain slippage guard,
// so the runner does not re-run Sealed Inference into another guaranteed revert
// every cycle. Deterministic: every call passes an explicit `nowMs`.

import test from "node:test";
import assert from "node:assert/strict";
import {
  recordSlippageBackoff,
  clearSlippageBackoff,
  getSlippageBackoffRemainingSec,
} from "./agent.js";
import { SLIPPAGE_BACKOFF_SEC } from "./strategy-constants.js";

const VAULT = "0x48967e963bb2903afb2fb1dbb086638063dfd1da";

test("no backoff armed → 0 remaining", () => {
  clearSlippageBackoff(VAULT);
  assert.equal(getSlippageBackoffRemainingSec(VAULT, 1_000_000), 0);
});

test("arming a backoff reports the full window remaining", () => {
  const now = 1_000_000;
  recordSlippageBackoff(VAULT, now);
  assert.equal(getSlippageBackoffRemainingSec(VAULT, now), SLIPPAGE_BACKOFF_SEC);
  clearSlippageBackoff(VAULT);
});

test("remaining decreases as time passes inside the window", () => {
  const now = 1_000_000;
  recordSlippageBackoff(VAULT, now);
  const remaining = getSlippageBackoffRemainingSec(VAULT, now + 60_000); // +60s
  assert.equal(remaining, SLIPPAGE_BACKOFF_SEC - 60);
  clearSlippageBackoff(VAULT);
});

test("backoff expires exactly at the window edge and sweeps the entry", () => {
  const now = 1_000_000;
  recordSlippageBackoff(VAULT, now);
  assert.equal(getSlippageBackoffRemainingSec(VAULT, now + SLIPPAGE_BACKOFF_SEC * 1000), 0);
  // A second read with an earlier timestamp confirms the entry was swept, not
  // merely reported as 0.
  assert.equal(getSlippageBackoffRemainingSec(VAULT, now + 1000), 0);
});

test("clearSlippageBackoff cancels an active window (success path)", () => {
  const now = 1_000_000;
  recordSlippageBackoff(VAULT, now);
  clearSlippageBackoff(VAULT);
  assert.equal(getSlippageBackoffRemainingSec(VAULT, now + 1000), 0);
});

test("backoff is keyed per vault, case-insensitive", () => {
  const now = 1_000_000;
  recordSlippageBackoff(VAULT.toUpperCase(), now);
  assert.equal(getSlippageBackoffRemainingSec(VAULT.toLowerCase(), now), SLIPPAGE_BACKOFF_SEC);
  clearSlippageBackoff(VAULT);
});
