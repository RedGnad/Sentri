// Tests for the durable audit index (the restart-surviving rootHash map on
// the Render persistent disk). Each test uses a fresh temp file.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  initAuditIndex,
  isAuditIndexReady,
  assertAuditIndexWritable,
  auditIndexExecutionAllowed,
  writeAuditIndexRecord,
  findAuditIndexByIntentHash,
  findAuditIndexByResponseHash,
  findAuditIndexByTxHash,
  findAuditIndexByVaultLog,
  getAuditIndexStats,
  type AuditIndexRecord,
} from "./audit-index.js";

function freshIndex(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sentri-idx-")), "audit-index.jsonl");
  initAuditIndex(p);
  return p;
}

function record(overrides: Partial<AuditIndexRecord> = {}): AuditIndexRecord {
  const now = Date.now();
  return {
    vaultAddress: "0xVault0000000000000000000000000000000001",
    intentHash: "0xINTENT01",
    responseHash: "0xRESP01",
    rootHash: "0xROOT01",
    storageTxHash: "0xSTORAGE01",
    action: "Rebalance",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("write then read back by intentHash", () => {
  freshIndex();
  writeAuditIndexRecord(record());
  const hit = findAuditIndexByIntentHash("0xINTENT01");
  assert.ok(hit);
  assert.equal(hit.rootHash, "0xroot01"); // stored lowercased
  assert.equal(hit.action, "Rebalance");
});

test("read back by responseHash", () => {
  freshIndex();
  writeAuditIndexRecord(record());
  const hit = findAuditIndexByResponseHash("0xRESP01");
  assert.ok(hit);
  assert.equal(hit.intentHash, "0xintent01");
});

test("post-tx append updates the record; txHash and logIndex become resolvable", () => {
  freshIndex();
  // pre-tx record: no txHash / logIndex yet
  writeAuditIndexRecord(record());
  assert.equal(findAuditIndexByTxHash("0xTX01"), null);
  // post-tx append with the same intentHash
  writeAuditIndexRecord(record({ txHash: "0xTX01", logIndex: 3, updatedAt: Date.now() + 1 }));
  const byTx = findAuditIndexByTxHash("0xTX01");
  assert.ok(byTx);
  assert.equal(byTx.logIndex, 3);
  assert.equal(byTx.rootHash, "0xroot01"); // pre-tx field still merged in
  const byLog = findAuditIndexByVaultLog("0xVault0000000000000000000000000000000001", 3);
  assert.ok(byLog);
  assert.equal(byLog.intentHash, "0xintent01");
});

test("corrupt / half-written JSONL lines are ignored, valid records still resolve", () => {
  const p = freshIndex();
  writeAuditIndexRecord(record());
  fs.appendFileSync(p, '{"intentHash":"0xBAD", "rootHash":\n'); // truncated line
  fs.appendFileSync(p, "not json at all\n");
  writeAuditIndexRecord(record({ intentHash: "0xINTENT02", rootHash: "0xROOT02" }));
  assert.ok(findAuditIndexByIntentHash("0xINTENT01"));
  assert.ok(findAuditIndexByIntentHash("0xINTENT02"));
  assert.equal(getAuditIndexStats().entries, 2);
});

test("unconfigured path → not ready, stats not ok (production gate trips)", () => {
  initAuditIndex(undefined); // no path
  assert.equal(isAuditIndexReady(), false);
  assert.equal(auditIndexExecutionAllowed("production"), false);
  const stats = getAuditIndexStats();
  assert.equal(stats.ok, false);
  assert.equal(stats.path, null);
  assert.throws(() => assertAuditIndexWritable(), /not configured/);
});

test("non-writable path → not ready, stats not ok", () => {
  // A path whose parent cannot be created (under an existing file).
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sentri-idx-")), "afile");
  fs.writeFileSync(f, "x");
  initAuditIndex(path.join(f, "nested", "audit-index.jsonl"));
  assert.equal(isAuditIndexReady(), false);
  assert.equal(auditIndexExecutionAllowed("production"), false);
  assert.equal(getAuditIndexStats().ok, false);
  assert.throws(() => assertAuditIndexWritable(), /not writable/);
});

test("production rejects an AUDIT_INDEX_PATH under /tmp", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    initAuditIndex("/tmp/sentri-audit-index.jsonl");
    assert.equal(isAuditIndexReady(), false);
    assert.equal(auditIndexExecutionAllowed("production"), false);
    assert.match(getAuditIndexStats().lastError ?? "", /must not point under \/tmp/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("a configured, writable path is ready and assertion passes", () => {
  freshIndex();
  assert.equal(isAuditIndexReady(), true);
  assert.equal(auditIndexExecutionAllowed("production"), true);
  assert.doesNotThrow(() => assertAuditIndexWritable());
  assert.equal(getAuditIndexStats().ok, true);
});

test("entries counts distinct executions, not appended lines", () => {
  freshIndex();
  writeAuditIndexRecord(record());
  writeAuditIndexRecord(record({ txHash: "0xTX01", logIndex: 0 })); // same intent, second line
  assert.equal(getAuditIndexStats().entries, 1);
});
