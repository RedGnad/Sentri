import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAwardPointsCli } from "./award-points.js";
import {
  awardPoints,
  buildManualUniqueKey,
  computeActiveVaultHourAwards,
  computeBlockedActionAwards,
  computeExecutionAwards,
  createPointsEntry,
  getLeaderboard,
  getPointsStats,
  getRecentPointEvents,
  getVaultPoints,
  getWalletPoints,
  hasAwardedUnique,
  initPointsLedger,
  isPointsLedgerReady,
  type PointsEntry,
} from "./points.js";

function freshLedger(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sentri-points-")), "points.jsonl");
  initPointsLedger(p);
  return p;
}

function entry(overrides: Partial<PointsEntry> = {}): PointsEntry {
  return createPointsEntry({
    uniqueKey: "manual:useful_feedback:0xwallet:feedback-1",
    wallet: "0xWallet",
    vaultAddress: "0xVault",
    type: "useful_feedback",
    points: 2_500,
    reason: "Useful feedback",
    createdAt: 1_779_400_000_000,
    ...overrides,
  });
}

test("write/read ledger", () => {
  freshLedger();
  const result = awardPoints(entry());
  assert.equal(result.awarded, true);
  assert.equal(getWalletPoints("0xwallet").total, 2_500);
  assert.equal(getPointsStats().entries, 1);
});

test("duplicate uniqueKey ignored", () => {
  freshLedger();
  assert.equal(awardPoints(entry()).awarded, true);
  const duplicate = awardPoints(entry({ points: 9_999 }));
  assert.equal(duplicate.awarded, false);
  assert.equal(duplicate.reason, "duplicate uniqueKey");
  assert.equal(getWalletPoints("0xwallet").total, 2_500);
});

test("leaderboard sorted", () => {
  freshLedger();
  awardPoints(entry({ uniqueKey: "manual:a", wallet: "0xbbb", points: 100 }));
  awardPoints(entry({ uniqueKey: "manual:b", wallet: "0xaaa", points: 300 }));
  awardPoints(entry({ uniqueKey: "manual:c", wallet: "0xccc", points: 200 }));
  assert.deepEqual(getLeaderboard(3).map((row) => row.wallet), ["0xaaa", "0xccc", "0xbbb"]);
});

test("wallet total correct", () => {
  freshLedger();
  awardPoints(entry({ uniqueKey: "manual:a", wallet: "0xabc", points: 100 }));
  awardPoints(entry({ uniqueKey: "manual:b", wallet: "0xabc", points: 250 }));
  awardPoints(entry({ uniqueKey: "manual:c", wallet: "0xdef", points: 900 }));
  assert.equal(getWalletPoints("0xAbC").total, 350);
});

test("vault total correct", () => {
  freshLedger();
  awardPoints(entry({ uniqueKey: "manual:a", vaultAddress: "0xvault1", points: 100 }));
  awardPoints(entry({ uniqueKey: "manual:b", vaultAddress: "0xvault1", points: 250 }));
  awardPoints(entry({ uniqueKey: "manual:c", vaultAddress: "0xvault2", points: 900 }));
  assert.equal(getVaultPoints("0xVault1").total, 350);
});

test("recent events sorted", () => {
  freshLedger();
  awardPoints(entry({ uniqueKey: "manual:old", createdAt: 100 }));
  awardPoints(entry({ uniqueKey: "manual:new", createdAt: 300 }));
  awardPoints(entry({ uniqueKey: "manual:mid", createdAt: 200 }));
  assert.deepEqual(getRecentPointEvents(2).map((event) => event.uniqueKey), ["manual:new", "manual:mid"]);
});

test("corrupt JSONL ignored", () => {
  const p = freshLedger();
  awardPoints(entry());
  fs.appendFileSync(p, '{"id":"broken","uniqueKey":\n');
  fs.appendFileSync(p, "not json\n");
  awardPoints(entry({ uniqueKey: "manual:second", points: 100 }));
  assert.equal(getWalletPoints("0xwallet").total, 2_600);
  assert.equal(getPointsStats().entries, 2);
});

test("manual exceptional_bonus works", () => {
  freshLedger();
  const result = awardPoints(entry({
    uniqueKey: buildManualUniqueKey("exceptional_bonus", "0xWallet", 20_000, "Early external vault bonus (lab rat)"),
    type: "exceptional_bonus",
    points: 20_000,
    reason: "Early external vault bonus (lab rat)",
  }));
  assert.equal(result.awarded, true);
  assert.equal(getWalletPoints("0xwallet").total, 20_000);
});

test("dry-run does not write", async () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sentri-points-cli-")), "points.jsonl");
  const code = await runAwardPointsCli(
    [
      "--wallet", "0xWallet",
      "--points", "20000",
      "--type", "exceptional_bonus",
      "--reason", "Early external vault bonus (lab rat)",
    ],
    { POINTS_LEDGER_PATH: p },
    { log: () => undefined, error: () => undefined },
  );
  assert.equal(code, 0);
  assert.equal(fs.existsSync(p), false);
});

test("missing POINTS_LEDGER_PATH does not crash", () => {
  const previous = process.env.POINTS_LEDGER_PATH;
  delete process.env.POINTS_LEDGER_PATH;
  try {
    initPointsLedger();
    assert.equal(isPointsLedgerReady(), false);
    assert.equal(getPointsStats().ok, false);
    assert.equal(awardPoints(entry()).awarded, false);
  } finally {
    if (previous === undefined) delete process.env.POINTS_LEDGER_PATH;
    else process.env.POINTS_LEDGER_PATH = previous;
  }
});

test("non-writable path returns points.ok=false", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sentri-points-")), "afile");
  fs.writeFileSync(f, "x");
  initPointsLedger(path.join(f, "nested", "points.jsonl"));
  const stats = getPointsStats();
  assert.equal(stats.ok, false);
  assert.equal(stats.writable, false);
});

test("active-hour uniqueKey prevents double count", () => {
  freshLedger();
  const now = Date.UTC(2026, 4, 22, 10, 15);
  const awards = computeActiveVaultHourAwards([
    { wallet: "0xWallet", vaultAddress: "0xVaultA", totalValueUsd: 0.2 },
    { wallet: "0xWallet", vaultAddress: "0xVaultB", totalValueUsd: 100 },
  ], { now });
  assert.equal(awards.length, 1);
  assert.equal(awardPoints(awards[0]).awarded, true);
  assert.equal(computeActiveVaultHourAwards([
    { wallet: "0xWallet", vaultAddress: "0xVaultA", totalValueUsd: 0.2 },
  ], { now }).length, 0);
  assert.equal(getWalletPoints("0xwallet").total, 100);
});

test("execution uniqueKey prevents double count", () => {
  freshLedger();
  const awards = computeExecutionAwards([
    {
      wallet: "0xWallet",
      vaultAddress: "0xVault",
      txHash: "0xTx",
      logIndex: 0,
      timestamp: Date.UTC(2026, 4, 22, 10, 15),
    },
  ]);
  assert.equal(awards.length, 1);
  assert.equal(awardPoints(awards[0]).awarded, true);
  assert.equal(hasAwardedUnique("execution:0xvault:0:0xtx"), true);
  assert.equal(computeExecutionAwards([
    {
      wallet: "0xWallet",
      vaultAddress: "0xVault",
      txHash: "0xTx",
      logIndex: 0,
      timestamp: Date.UTC(2026, 4, 22, 10, 15),
    },
  ]).length, 0);
  assert.equal(getWalletPoints("0xwallet").total, 1_000);
});

test("safe blocked action awards are capped and system errors are ignored", () => {
  freshLedger();
  const timestamp = Date.UTC(2026, 4, 22, 12, 0);
  const awards = computeBlockedActionAwards([
    ...Array.from({ length: 11 }, (_, i) => ({
      wallet: "0xWallet",
      vaultAddress: "0xVault",
      reason: "Verifier rejection",
      timestamp: timestamp + i,
      hash: `0x${i}`,
      safe: true,
    })),
    {
      wallet: "0xWallet",
      vaultAddress: "0xVault",
      reason: "RPC timeout",
      timestamp,
      hash: "0xsystem",
      safe: false,
    },
  ]);
  assert.equal(awards.length, 10);
  for (const award of awards) awardPoints(award);
  assert.equal(getWalletPoints("0xwallet").total, 15_000);
});
