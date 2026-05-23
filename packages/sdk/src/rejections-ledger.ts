// Durable rejection ledger — restart-surviving record of safe blocked actions.
//
// Why this exists: Render /tmp is ephemeral. When Sentri blocks an action
// (e.g. InsufficientAmountOut slippage guard, CooldownNotElapsed) the old
// code wrote only to /tmp/sentri-cache. After a Render restart that entry
// vanished. Safe rejections are part of Sentri's proof story and must
// survive redeploy.
//
// Storage format: append-only JSONL on the Render persistent disk (/data).
// Each line is one RejectionEntry. Idempotent by `id` — the same event
// written twice appears once. Corrupt / half-written lines are skipped.
//
// Security: never writes under /tmp in production (hard-checked at init).
// Failure is non-fatal: Sentri continues but logs CRITICAL.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type RejectionPhase = "estimate" | "preflight" | "execution";

export interface RejectionEntry {
  id: string;
  vaultAddress: string;
  /** estimate = gas check failed, no tx sent; preflight = blocked before tx; execution = tx sent but reverted */
  phase: RejectionPhase;
  action: string;
  reason: string;
  humanReason: string;
  txSent: boolean;
  fundsMoved: boolean;
  intentHash?: string;
  responseHash?: string;
  teeSigner?: string;
  teeAttestation?: string;
  rootHash?: string;
  createdAt: number;
}

export interface RejectionsLedgerStats {
  ok: boolean;
  path: string | null;
  writable: boolean;
  entries: number;
  lastError: string | null;
}

interface LedgerState {
  path: string | null;
  writable: boolean;
  lastError: string | null;
  initialized: boolean;
  seenIds: Set<string>;
}

const state: LedgerState = {
  path: null,
  writable: false,
  lastError: null,
  initialized: false,
  seenIds: new Set(),
};

const lc = (s: string): string => s.toLowerCase();

// ── Stable ID ─────────────────────────────────────────────────────────────
// Deterministic so the same rejection event always gets the same id,
// enabling idempotent writes across restarts.

export function makeRejectionId(
  vaultAddress: string,
  createdAt: number,
  type: string,
  errorCode?: string,
): string {
  const h = crypto
    .createHash("sha256")
    .update(`${lc(vaultAddress)}:${createdAt}:${type}:${errorCode ?? ""}`)
    .digest("hex");
  return `rej_${h.slice(0, 24)}`;
}

// ── Init ──────────────────────────────────────────────────────────────────

export function initRejectionsLedger(explicitPath?: string): RejectionsLedgerStats {
  const resolved = explicitPath ?? process.env.REJECTIONS_LEDGER_PATH ?? null;
  state.path = resolved;
  state.writable = false;
  state.lastError = null;
  state.initialized = true;
  state.seenIds = new Set();

  if (!resolved) {
    state.lastError = "REJECTIONS_LEDGER_PATH not configured";
    return { ok: false, path: null, writable: false, entries: 0, lastError: state.lastError };
  }
  if (process.env.NODE_ENV === "production") {
    const rp = path.resolve(resolved);
    if (rp === "/tmp" || rp.startsWith("/tmp/")) {
      state.lastError = "REJECTIONS_LEDGER_PATH must not point under /tmp in production";
      return { ok: false, path: resolved, writable: false, entries: 0, lastError: state.lastError };
    }
  }
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    if (!fs.existsSync(resolved)) fs.writeFileSync(resolved, "");
    const fd = fs.openSync(resolved, "a");
    fs.closeSync(fd);
    state.writable = true;
    // Pre-load seen IDs so duplicate writes after a restart are idempotent.
    for (const e of _readAll()) state.seenIds.add(e.id);
  } catch (err) {
    state.writable = false;
    state.lastError = err instanceof Error ? err.message : String(err);
  }
  return getRejectionsStats();
}

// ── Parse / validate ──────────────────────────────────────────────────────

function isPhase(v: unknown): v is RejectionPhase {
  return v === "estimate" || v === "preflight" || v === "execution";
}

function normalizeEntry(raw: unknown): RejectionEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RejectionEntry>;
  if (
    typeof r.id !== "string" ||
    typeof r.vaultAddress !== "string" ||
    !isPhase(r.phase) ||
    typeof r.action !== "string" ||
    typeof r.reason !== "string" ||
    typeof r.humanReason !== "string" ||
    typeof r.txSent !== "boolean" ||
    typeof r.fundsMoved !== "boolean" ||
    typeof r.createdAt !== "number" ||
    !Number.isFinite(r.createdAt)
  ) {
    return null;
  }
  return {
    id: r.id,
    vaultAddress: lc(r.vaultAddress),
    phase: r.phase,
    action: r.action,
    reason: r.reason,
    humanReason: r.humanReason,
    txSent: r.txSent,
    fundsMoved: r.fundsMoved,
    intentHash: typeof r.intentHash === "string" ? r.intentHash : undefined,
    responseHash: typeof r.responseHash === "string" ? r.responseHash : undefined,
    teeSigner: typeof r.teeSigner === "string" ? r.teeSigner : undefined,
    teeAttestation: typeof r.teeAttestation === "string" ? r.teeAttestation : undefined,
    rootHash: typeof r.rootHash === "string" ? r.rootHash : undefined,
    createdAt: r.createdAt,
  };
}

function _readAll(): RejectionEntry[] {
  if (!state.path || !fs.existsSync(state.path)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(state.path, "utf-8");
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    return [];
  }
  const out: RejectionEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = normalizeEntry(JSON.parse(trimmed));
      if (entry) out.push(entry);
    } catch {
      // Corrupt or half-written line — skip, never throw.
    }
  }
  return out;
}

// ── Write ─────────────────────────────────────────────────────────────────

export function writeRejection(entry: RejectionEntry): void {
  if (!state.initialized) initRejectionsLedger();
  if (!state.path || !state.writable) {
    console.error(`CRITICAL: safe rejection was not persisted (ledger not ready): ${entry.id}`);
    return;
  }
  if (state.seenIds.has(entry.id)) return; // idempotent
  const normalized = normalizeEntry(entry);
  if (!normalized) {
    console.error(`CRITICAL: safe rejection was not persisted (invalid entry shape): id=${entry.id}`);
    return;
  }
  try {
    fs.appendFileSync(state.path, JSON.stringify(normalized) + "\n");
    state.seenIds.add(entry.id);
    state.writable = true;
    state.lastError = null;
  } catch (err) {
    state.writable = false;
    state.lastError = err instanceof Error ? err.message : String(err);
    console.error(`CRITICAL: safe rejection was not persisted: ${state.lastError}`);
  }
}

// ── Read ──────────────────────────────────────────────────────────────────

export function getRejectionsForVault(vaultAddress: string): RejectionEntry[] {
  if (!state.initialized) initRejectionsLedger();
  const vault = lc(vaultAddress);
  return _readAll()
    .filter((e) => e.vaultAddress === vault)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getRecentRejections(limit = 50): RejectionEntry[] {
  if (!state.initialized) initRejectionsLedger();
  return _readAll()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

// ── Stats ─────────────────────────────────────────────────────────────────

export function getRejectionsStats(): RejectionsLedgerStats {
  if (!state.initialized) initRejectionsLedger();
  return {
    ok: Boolean(state.path) && state.writable,
    path: state.path,
    writable: state.writable,
    entries: state.seenIds.size, // O(1) — pre-loaded at init, updated on write
    lastError: state.lastError,
  };
}
