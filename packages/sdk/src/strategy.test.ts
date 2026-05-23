import test from "node:test";
import assert from "node:assert/strict";
import { computeStrategy } from "./agent.js";

test("strategy target is capped by maxAllocationBps", () => {
  const recommendation = computeStrategy({
    currentShare: 15,
    drawdownPct: 0,
    change24h: 2,
    spreadPct: 0.5,
    baseBalance: 0.0935,
    riskBalance: 0.033398512099244187,
    tvl: 0.109974,
    priceUsd: 0.4941,
    maxAllocationBps: 1500,
    rebalanceThresholdBps: 200,
  });

  assert.equal(recommendation.regime, "up_tight");
  assert.equal(recommendation.targetShare, 15);
  assert.equal(recommendation.recommendedAction, "hold");
  assert.equal(recommendation.recommendedAmountBps, 0);
});

test("strategy holds instead of treating unavailable momentum as flat", () => {
  const recommendation = computeStrategy({
    currentShare: 0,
    drawdownPct: 0,
    change24h: 0,
    spreadPct: 0.2,
    baseBalance: 0.25,
    riskBalance: 0,
    tvl: 0.25,
    priceUsd: 0.48,
    maxAllocationBps: 3000,
    rebalanceThresholdBps: 300,
    momentumAvailable: false,
  });

  assert.equal(recommendation.regime, "momentum_unavailable");
  assert.equal(recommendation.recommendedAction, "hold");
  assert.equal(recommendation.recommendedAmountBps, 0);
});

test("drawdown breach remains defensive even when momentum is unavailable", () => {
  const recommendation = computeStrategy({
    currentShare: 20,
    drawdownPct: 2,
    change24h: 0,
    spreadPct: 0.2,
    baseBalance: 0.2,
    riskBalance: 0.1,
    tvl: 0.25,
    priceUsd: 0.5,
    maxAllocationBps: 3000,
    rebalanceThresholdBps: 300,
    momentumAvailable: false,
  });

  assert.equal(recommendation.regime, "drawdown_breach");
  assert.equal(recommendation.recommendedAction, "EmergencyDeleverage");
});
