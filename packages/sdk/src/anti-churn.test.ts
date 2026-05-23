// Tests for evaluateAntiChurn — the deterministic guard that damps
// regime-boundary churn (sub-economic trades and small direction reversals)
// before the runner spends Sealed Inference on them. Pure function; the
// thresholds are the strategy-constants defaults.

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAntiChurn, type AntiChurnInput } from "./agent.js";

// A trade large enough to clear MIN_TRADE_NOTIONAL_USD ($0.01) so reversal
// tests exercise check (B), not check (A).
const SIZED = 0.05;

function base(overrides: Partial<AntiChurnInput> = {}): AntiChurnInput {
  return {
    recommendedAction: "Rebalance",
    tradeValueUsd: SIZED,
    regime: "up_tight",
    driftPp: 3,
    lastExecutedAction: 2, // EmergencyDeleverage (sell)
    secondsSinceLastExecution: 1800,
    regimeObservations: 1,
    ...overrides,
  };
}

test("blocks a small reversal when the regime is not yet confirmed", () => {
  // last buy → next sell, recent, regime seen once, drift below override
  const v = evaluateAntiChurn(
    base({ recommendedAction: "EmergencyDeleverage", lastExecutedAction: 0, regime: "flat" }),
  );
  assert.equal(v.block, true);
  assert.match(v.reason ?? "", /anti-churn/);
});

test("blocks a buy→sell reversal symmetrically", () => {
  const v = evaluateAntiChurn(
    base({ recommendedAction: "EmergencyDeleverage", lastExecutedAction: 0, regime: "flat" }),
  );
  assert.equal(v.block, true);
  assert.match(v.reason ?? "", /anti-churn/);
});

test("allows the reversal once the regime is confirmed over enough cycles", () => {
  const v = evaluateAntiChurn(
    base({
      recommendedAction: "EmergencyDeleverage",
      lastExecutedAction: 0,
      regime: "flat",
      regimeObservations: 2,
    }),
  );
  assert.equal(v.block, false);
});

test("allows the reversal when the drift is large", () => {
  const v = evaluateAntiChurn(
    base({ recommendedAction: "EmergencyDeleverage", lastExecutedAction: 0, regime: "flat", driftPp: 6 }),
  );
  assert.equal(v.block, false);
});

test("blocks post-defensive buy re-entry even when drift is large", () => {
  const v = evaluateAntiChurn(base({
    driftPp: 22,
    regimeObservations: 20,
    secondsSinceLastExecution: 3600,
  }));
  assert.equal(v.block, true);
  assert.match(v.reason ?? "", /post-defensive re-entry/);
});

test("allows post-defensive buy re-entry after delay and confirmation", () => {
  const v = evaluateAntiChurn(base({
    driftPp: 22,
    regimeObservations: 3,
    secondsSinceLastExecution: 3 * 3600,
  }));
  assert.equal(v.block, false);
});

test("safety regime (drawdown_breach) bypasses the reversal guard", () => {
  const v = evaluateAntiChurn(base({ regime: "drawdown_breach" }));
  assert.equal(v.block, false);
});

test("safety regime (crash) bypasses the reversal guard", () => {
  const v = evaluateAntiChurn(base({ regime: "crash" }));
  assert.equal(v.block, false);
});

test("allows the reversal once it is outside the anti-churn window", () => {
  const v = evaluateAntiChurn(base({ secondsSinceLastExecution: 7 * 3600 }));
  assert.equal(v.block, false);
});

test("allows a same-direction trade (not a reversal)", () => {
  // last buy, next buy
  const v = evaluateAntiChurn(base({ recommendedAction: "Rebalance", lastExecutedAction: 0 }));
  assert.equal(v.block, false);
});

test("allows when there is no prior execution to reverse", () => {
  const v = evaluateAntiChurn(base({ lastExecutedAction: null, secondsSinceLastExecution: null }));
  assert.equal(v.block, false);
});

test("blocks a sub-economic trade regardless of direction", () => {
  const v = evaluateAntiChurn(base({ tradeValueUsd: 0.0076, recommendedAction: "Rebalance", lastExecutedAction: 0 }));
  assert.equal(v.block, true);
  assert.match(v.reason ?? "", /minimum economic size/);
});

test("a safety regime still executes a small defensive trade", () => {
  const v = evaluateAntiChurn(base({ tradeValueUsd: 0.005, regime: "crash" }));
  assert.equal(v.block, false);
});
