// Tests for the durable rejections ledger (the restart-surviving blocked-action
// record on the Render persistent disk). Each test uses a fresh temp file.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  initRejectionsLedger,
  writeRejection,
  getRejectionsForVault,
  getRecentRejections,
  getRejectionsStats,
  makeRejectionId,
  type RejectionEntry,
} from "./rejections-ledger.js";

const VAULT = "0xVault0000000000000000000000000000000001";
const VAULT2 = "0xVault0000000000000000000000000000000002";

function freshLedger(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sentri-rej-")), "rejections.jsonl");
  initRejectionsLedger(p);
  return p;
}

function insufficientAmountOutEntry(overrides: Partial<RejectionEntry> = {}): RejectionEntry {
  const now = Date.now();
  return {
    id: makeRejectionId(VAULT, now, "onchain-revert", "InsufficientAmountOut"),
    vaultAddress: VAULT,
    phase: "estimate",
    action: "Rebalance",
    reason: "On-chain revert: swap slippage guard triggered",
    humanReason: "Swap output fell below the slippage-protected minimum.",
    txSent: false,
    fundsMoved: false,
    intentHash: "0xINTENT01",
    createdAt: now,
    ...overrides,
  };
}

// ── Test 1–3: write, persist, read back by vault ──────────────────────────

test("InsufficientAmountOut rejection: write, persist to JSONL, read back by vault", () => {
  freshLedger();
  const entry = insufficientAmountOutEntry();
  writeRejection(entry);

  const found = getRejectionsForVault(VAULT);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, entry.id);
  assert.equal(found[0].phase, "estimate");
  assert.equal(found[0].txSent, false);
  assert.equal(found[0].fundsMoved, false);
  assert.equal(found[0].humanReason, "Swap output fell below the slippage-protected minimum.");
  assert.equal(found[0].action, "Rebalance");
  assert.equal(found[0].vaultAddress, VAULT.toLowerCase());

  // Verify the file was actually written (not just in-memory).
  const stats = getRejectionsStats();
  assert.equal(stats.ok, true);
  assert.equal(stats.entries, 1);
});

// ── Test 4: duplicate id does not double-count ────────────────────────────

test("duplicate id does not double-count", () => {
  freshLedger();
  const entry = insufficientAmountOutEntry();
  writeRejection(entry);
  writeRejection(entry); // same id
  writeRejection({ ...entry }); // clone same id

  assert.equal(getRejectionsStats().entries, 1);
  assert.equal(getRejectionsForVault(VAULT).length, 1);
});

// ── Test 5: corrupt JSONL line is ignored ─────────────────────────────────

test("corrupt JSONL line is ignored; valid entries still readable", () => {
  const p = freshLedger();
  const e1 = insufficientAmountOutEntry();
  const e2 = insufficientAmountOutEntry({ id: makeRejectionId(VAULT, Date.now() + 1, "onchain-revert", "CooldownNotElapsed"), humanReason: "Cooldown" });
  writeRejection(e1);
  // Inject corrupt lines after writing the first entry.
  fs.appendFileSync(p, '{"id":"0xBAD","vaultAddress":"0xVault"\n'); // truncated
  fs.appendFileSync(p, "not json at all\n");
  fs.appendFileSync(p, "{}\n"); // missing required fields
  writeRejection(e2);

  const found = getRejectionsForVault(VAULT);
  assert.equal(found.length, 2);
  const ids = found.map((e) => e.id);
  assert.ok(ids.includes(e1.id));
  assert.ok(ids.includes(e2.id));
});

// ── Test 6: audit response includes durable rejection ─────────────────────
// Tests the data path: write a rejection → it appears in getRejectionsForVault
// → server endpoint can merge it into the audit response.

test("durable rejection survives process restart (re-init reads file)", () => {
  const p = freshLedger();
  const entry = insufficientAmountOutEntry();
  writeRejection(entry);
  assert.equal(getRejectionsStats().entries, 1);

  // Simulate Render restart: re-init the module from the same file.
  initRejectionsLedger(p);
  const after = getRejectionsForVault(VAULT);
  assert.equal(after.length, 1, "rejection must still appear after re-init");
  assert.equal(after[0].id, entry.id);
  assert.equal(after[0].humanReason, "Swap output fell below the slippage-protected minimum.");

  // Now write a new one — no duplication.
  const entry2 = insufficientAmountOutEntry({
    id: makeRejectionId(VAULT, entry.createdAt + 1, "onchain-revert", "CooldownNotElapsed"),
    humanReason: "Cooldown.",
  });
  writeRejection(entry2);
  assert.equal(getRejectionsStats().entries, 2);
});

// ── Test 7: missing ledger path does not crash Sentri ─────────────────────

test("missing REJECTIONS_LEDGER_PATH does not crash — returns safe no-op state", () => {
  // Init without any path.
  const stats = initRejectionsLedger(undefined);
  assert.equal(stats.ok, false);
  assert.equal(stats.entries, 0);
  assert.ok(stats.lastError);

  // All read/write operations must be silent no-ops.
  const entry = insufficientAmountOutEntry();
  assert.doesNotThrow(() => writeRejection(entry));
  assert.deepEqual(getRejectionsForVault(VAULT), []);
  assert.deepEqual(getRecentRejections(10), []);
  assert.equal(getRejectionsStats().ok, false);
});

// ── Bonus: getRecentRejections returns across vaults, sorted ─────────────

test("getRecentRejections returns entries across all vaults sorted newest-first", () => {
  freshLedger();
  const t = Date.now();
  const a = insufficientAmountOutEntry({ id: makeRejectionId(VAULT, t, "onchain-revert", "IA"), createdAt: t });
  const b = insufficientAmountOutEntry({ id: makeRejectionId(VAULT2, t + 1000, "onchain-revert", "IA"), vaultAddress: VAULT2, createdAt: t + 1000 });
  writeRejection(a);
  writeRejection(b);

  const recent = getRecentRejections(10);
  assert.equal(recent.length, 2);
  assert.ok(recent[0].createdAt >= recent[1].createdAt, "should be sorted newest-first");
});
