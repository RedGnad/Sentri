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
