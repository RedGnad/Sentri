// Durable audit index — restart-surviving map from on-chain execution
// identifiers to the 0G Storage rootHash of the enriched audit record.
//
// Why this exists: 0G Storage KV reads require a KV node, and there is no
// public 0G KV node — the dev KV endpoint is dead. After a Render restart the
// in-memory/`/tmp` cache is wiped, so `/audit` lost the rootHash needed to
// download the enriched TEE reasoning and degraded to a chain-only fallback.
//
// This module persists ONLY index metadata (no reasoning text) to the Render
// persistent disk (`/data`). The full TEE reasoning stays in the audit record
// on 0G Storage — the source of truth. `/audit` resolves a rootHash here, then
// downloads the record from 0G Storage.
//
// Storage format: append-only JSONL. Each line is one AuditIndexRecord. When a
// field is learned later (e.g. txHash after the tx confirms) a new line is
// appended with the same intentHash; readers merge by intentHash, last wins
// per field. Append-only avoids native deps (no SQLite) and is crash-safe: a
// half-written trailing line is simply ignored.

import fs from "node:fs";
import path from "node:path";

export interface AuditIndexRecord {
  vaultAddress: string;
  /** On-chain executeStrategy tx hash. Absent on the pre-tx record. */
  txHash?: string;
  /** On-chain execution log index. Absent on the pre-tx record. */
  logIndex?: number;
  /** Keccak of the canonical intent — the primary key. */
  intentHash: string;
  /** TEE response hash. */
  responseHash?: string;
  /** 0G Storage rootHash of the enriched audit record (the reasoning lives there). */
  rootHash: string;
  /** 0G Storage submission tx for the audit record. */
  storageTxHash?: string;
  action?: string;
  createdAt: number;
  updatedAt: number;
}

interface AuditIndexState {
  /** Resolved file path, or null when AUDIT_INDEX_PATH is unset. */
  path: string | null;
  /** True once the path exists and a write probe succeeded. */
  writable: boolean;
  lastError: string | null;
  initialized: boolean;
}

const state: AuditIndexState = {
  path: null,
  writable: false,
  lastError: null,
  initialized: false,
};

const lc = (s: string): string => s.toLowerCase();

/**
 * Initialize the durable audit index. Resolves the path from `explicitPath`
 * or the `AUDIT_INDEX_PATH` env var, ensures the parent directory and file
 * exist, and runs a write probe. Idempotent-ish: safe to call again to
 * re-resolve (used by tests). Never throws — inspect getAuditIndexStats().
 */
export function initAuditIndex(explicitPath?: string): AuditIndexState {
  const resolved = explicitPath ?? process.env.AUDIT_INDEX_PATH ?? null;
  state.path = resolved;
  state.writable = false;
  state.lastError = null;
  state.initialized = true;

  if (!resolved) {
    state.lastError = "AUDIT_INDEX_PATH not configured";
    return { ...state };
  }
  if (process.env.NODE_ENV === "production") {
    const resolvedPath = path.resolve(resolved);
    if (resolvedPath === "/tmp" || resolvedPath.startsWith("/tmp/")) {
      state.lastError = "AUDIT_INDEX_PATH must not point under /tmp in production";
      return { ...state };
    }
  }
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    if (!fs.existsSync(resolved)) fs.writeFileSync(resolved, "");
    // Write probe: append + nothing — fs.accessSync is not enough on some
    // mounts, so actually open the file for appending.
    const fd = fs.openSync(resolved, "a");
    fs.closeSync(fd);
    state.writable = true;
  } catch (err) {
    state.writable = false;
    state.lastError = err instanceof Error ? err.message : String(err);
  }
  return { ...state };
}

/** True when the index is configured and writable. */
export function isAuditIndexReady(): boolean {
  if (!state.initialized) initAuditIndex();
  return Boolean(state.path) && state.writable;
}

/**
 * Throw if the index is not usable. The runtime calls this before any
 * funds-moving tx in production so a misconfigured disk fails closed.
 */
export function assertAuditIndexWritable(): void {
  if (!state.initialized) initAuditIndex();
  if (!state.path) throw new Error("AUDIT_INDEX_PATH not configured");
  if (!state.writable) {
    throw new Error(`audit index not writable: ${state.lastError ?? "unknown error"}`);
  }
}

/**
 * Append one record to the durable JSONL index. Throws on failure so callers
 * can block execution (no durable index → no funds-moving tx).
 */
export function writeAuditIndexRecord(record: AuditIndexRecord): void {
  if (!state.initialized) initAuditIndex();
  if (!state.path) throw new Error("AUDIT_INDEX_PATH not configured");
  const line = JSON.stringify({
    ...record,
    vaultAddress: lc(record.vaultAddress),
    intentHash: lc(record.intentHash),
    responseHash: record.responseHash ? lc(record.responseHash) : undefined,
    txHash: record.txHash ? lc(record.txHash) : undefined,
    rootHash: lc(record.rootHash),
  });
  try {
    fs.appendFileSync(state.path, line + "\n");
    state.writable = true;
    state.lastError = null;
  } catch (err) {
    state.writable = false;
    state.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

/** Parse the JSONL file, skipping any corrupt/half-written lines. */
function readAllRecords(): AuditIndexRecord[] {
  if (!state.initialized) initAuditIndex();
  if (!state.path || !fs.existsSync(state.path)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(state.path, "utf-8");
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    return [];
  }
  const out: AuditIndexRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as AuditIndexRecord;
      if (parsed && typeof parsed.intentHash === "string" && typeof parsed.rootHash === "string") {
        out.push(parsed);
      }
    } catch {
      // Corrupt or half-written line — ignore, never throw.
    }
  }
  return out;
}

/**
 * Merge every record sharing `intentHash` into one, later lines overriding
 * earlier defined fields. Returns the consolidated view of that execution.
 */
function mergeByIntentHash(records: AuditIndexRecord[], intentHash: string): AuditIndexRecord | null {
  const key = lc(intentHash);
  const matching = records.filter((r) => lc(r.intentHash) === key);
  if (matching.length === 0) return null;
  let merged = { ...matching[0] };
  for (const r of matching.slice(1)) {
    for (const [k, v] of Object.entries(r)) {
      if (v !== undefined && v !== null) (merged as Record<string, unknown>)[k] = v;
    }
  }
  return merged;
}

/** Look up the consolidated index record for an intent hash. */
export function findAuditIndexByIntentHash(intentHash: string): AuditIndexRecord | null {
  return mergeByIntentHash(readAllRecords(), intentHash);
}

/** Look up by TEE response hash (resolves the intent, then merges). */
export function findAuditIndexByResponseHash(responseHash: string): AuditIndexRecord | null {
  const records = readAllRecords();
  const key = lc(responseHash);
  const hit = [...records].reverse().find((r) => r.responseHash && lc(r.responseHash) === key);
  return hit ? mergeByIntentHash(records, hit.intentHash) : null;
}

/** Look up by on-chain executeStrategy tx hash. */
export function findAuditIndexByTxHash(txHash: string): AuditIndexRecord | null {
  const records = readAllRecords();
  const key = lc(txHash);
  const hit = [...records].reverse().find((r) => r.txHash && lc(r.txHash) === key);
  return hit ? mergeByIntentHash(records, hit.intentHash) : null;
}

/** Look up by vault address + on-chain execution log index. */
export function findAuditIndexByVaultLog(
  vaultAddress: string,
  logIndex: number,
): AuditIndexRecord | null {
  const records = readAllRecords();
  const vault = lc(vaultAddress);
  const hit = [...records].reverse().find((r) => lc(r.vaultAddress) === vault && r.logIndex === logIndex);
  return hit ? mergeByIntentHash(records, hit.intentHash) : null;
}

/**
 * Runtime gate: in production the durable index is required before the runner
 * may execute funds-moving transactions. Local/dev runs stay possible.
 */
export function auditIndexExecutionAllowed(nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production" || isAuditIndexReady();
}

export interface AuditIndexStats {
  ok: boolean;
  path: string | null;
  writable: boolean;
  /** Distinct executions (unique intentHash) indexed. */
  entries: number;
  lastError: string | null;
}

/** Health snapshot for `/healthz`. */
export function getAuditIndexStats(): AuditIndexStats {
  if (!state.initialized) initAuditIndex();
  let entries = 0;
  if (state.path && state.writable) {
    entries = new Set(readAllRecords().map((r) => lc(r.intentHash))).size;
  }
  return {
    ok: Boolean(state.path) && state.writable,
    path: state.path,
    writable: state.writable,
    entries,
    lastError: state.lastError,
  };
}
