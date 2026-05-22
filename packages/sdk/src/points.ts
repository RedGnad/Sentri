import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const POINTS_RULES = {
  active_vault_hour: 100,
  verified_execution: 1_000,
  safe_blocked_action: 1_500,
  useful_feedback: 2_500,
  shipped_bug_report: 5_000,
} as const;

const DEFAULT_ACTIVE_VAULT_MIN_TVL_USD = 0.01;

export type PointType =
  | "active_vault_hour"
  | "verified_execution"
  | "safe_blocked_action"
  | "useful_feedback"
  | "shipped_bug_report"
  | "exceptional_bonus";

export interface PointsEntry {
  id: string;
  uniqueKey: string;
  wallet: string;
  vaultAddress?: string;
  type: PointType;
  points: number;
  reason: string;
  txHash?: string;
  logIndex?: number;
  createdAt: number;
}

export interface PointsAwardResult {
  awarded: boolean;
  entry: PointsEntry;
  reason?: string;
}

interface PointsLedgerState {
  path: string | null;
  writable: boolean;
  lastError: string | null;
  initialized: boolean;
}

export interface PointsStats {
  ok: boolean;
  path: string | null;
  writable: boolean;
  entries: number;
  lastError: string | null;
}

export interface WalletPoints {
  wallet: string;
  total: number;
  entries: PointsEntry[];
}

export interface VaultPoints {
  vaultAddress: string;
  total: number;
  entries: PointsEntry[];
}

export interface LeaderboardEntry {
  wallet: string;
  points: number;
  events: number;
}

export interface ActiveVaultCandidate {
  wallet: string;
  vaultAddress?: string;
  paused?: boolean;
  killed?: boolean;
  totalValueUsd?: number;
  tvlUsd?: number;
  active?: boolean;
}

export interface ActiveVaultHourOptions {
  now?: number;
  minTvlUsd?: number;
}

export interface ExecutionAwardCandidate {
  wallet: string;
  vaultAddress: string;
  txHash: string;
  logIndex: number;
  timestamp?: number;
}

export interface BlockedActionAwardCandidate {
  wallet: string;
  vaultAddress: string;
  reason: string;
  timestamp: number;
  hash?: string;
  txHash?: string;
  safe?: boolean;
}

const state: PointsLedgerState = {
  path: null,
  writable: false,
  lastError: null,
  initialized: false,
};

function lc(value: string): string {
  return value.toLowerCase();
}

function stableId(uniqueKey: string): string {
  return `points_${crypto.createHash("sha256").update(uniqueKey).digest("hex").slice(0, 24)}`;
}

export function createPointsEntry(
  input: Omit<PointsEntry, "id"> & { id?: string },
): PointsEntry {
  const uniqueKey = lc(input.uniqueKey);
  return {
    ...input,
    id: input.id ?? stableId(uniqueKey),
    uniqueKey,
    wallet: lc(input.wallet),
    vaultAddress: input.vaultAddress ? lc(input.vaultAddress) : undefined,
    txHash: input.txHash ? lc(input.txHash) : undefined,
  };
}

function isPointType(value: unknown): value is PointType {
  return typeof value === "string" && (
    value === "active_vault_hour" ||
    value === "verified_execution" ||
    value === "safe_blocked_action" ||
    value === "useful_feedback" ||
    value === "shipped_bug_report" ||
    value === "exceptional_bonus"
  );
}

function normalizeEntry(value: unknown): PointsEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PointsEntry>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.uniqueKey !== "string" ||
    typeof raw.wallet !== "string" ||
    !isPointType(raw.type) ||
    typeof raw.points !== "number" ||
    !Number.isFinite(raw.points) ||
    typeof raw.reason !== "string" ||
    typeof raw.createdAt !== "number"
  ) {
    return null;
  }
  return createPointsEntry({
    id: raw.id,
    uniqueKey: raw.uniqueKey,
    wallet: raw.wallet,
    vaultAddress: typeof raw.vaultAddress === "string" ? raw.vaultAddress : undefined,
    type: raw.type,
    points: raw.points,
    reason: raw.reason,
    txHash: typeof raw.txHash === "string" ? raw.txHash : undefined,
    logIndex: typeof raw.logIndex === "number" ? raw.logIndex : undefined,
    createdAt: raw.createdAt,
  });
}

export function initPointsLedger(explicitPath?: string): PointsLedgerState {
  const resolved = explicitPath ?? process.env.POINTS_LEDGER_PATH ?? null;
  state.path = resolved;
  state.writable = false;
  state.lastError = null;
  state.initialized = true;

  if (!resolved) {
    state.lastError = "POINTS_LEDGER_PATH not configured";
    return { ...state };
  }
  if (process.env.NODE_ENV === "production") {
    const resolvedPath = path.resolve(resolved);
    if (resolvedPath === "/tmp" || resolvedPath.startsWith("/tmp/")) {
      state.lastError = "POINTS_LEDGER_PATH must not point under /tmp in production";
      return { ...state };
    }
  }
  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    if (!fs.existsSync(resolved)) fs.writeFileSync(resolved, "");
    const fd = fs.openSync(resolved, "a");
    fs.closeSync(fd);
    state.writable = true;
  } catch (err) {
    state.writable = false;
    state.lastError = err instanceof Error ? err.message : String(err);
  }
  return { ...state };
}

export function isPointsLedgerReady(): boolean {
  if (!state.initialized) initPointsLedger();
  return Boolean(state.path) && state.writable;
}

export function assertPointsLedgerWritable(): void {
  if (!state.initialized) initPointsLedger();
  if (!state.path) throw new Error("POINTS_LEDGER_PATH not configured");
  if (!state.writable) {
    throw new Error(`points ledger not writable: ${state.lastError ?? "unknown error"}`);
  }
}

function readAllEntries(): PointsEntry[] {
  if (!state.initialized) initPointsLedger();
  if (!state.path || !fs.existsSync(state.path)) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(state.path, "utf-8");
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    return [];
  }
  const entries: PointsEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = normalizeEntry(JSON.parse(trimmed) as unknown);
      if (parsed) entries.push(parsed);
    } catch {
      // Corrupt or half-written JSONL line: ignore, never crash.
    }
  }
  return entries;
}

export function hasAwardedUnique(uniqueKey: string): boolean {
  const key = lc(uniqueKey);
  return readAllEntries().some((entry) => entry.uniqueKey === key);
}

export function awardPoints(entry: PointsEntry): PointsAwardResult {
  const normalized = createPointsEntry(entry);
  if (!state.initialized) initPointsLedger();
  if (!state.path || !state.writable) {
    return {
      awarded: false,
      entry: normalized,
      reason: state.lastError ?? "points ledger unavailable",
    };
  }
  if (hasAwardedUnique(normalized.uniqueKey)) {
    return { awarded: false, entry: normalized, reason: "duplicate uniqueKey" };
  }
  try {
    fs.appendFileSync(state.path, JSON.stringify(normalized) + "\n");
    state.writable = true;
    state.lastError = null;
    return { awarded: true, entry: normalized };
  } catch (err) {
    state.writable = false;
    state.lastError = err instanceof Error ? err.message : String(err);
    return { awarded: false, entry: normalized, reason: state.lastError };
  }
}

export function getWalletPoints(wallet: string): WalletPoints {
  const key = lc(wallet);
  const entries = readAllEntries().filter((entry) => entry.wallet === key);
  return {
    wallet: key,
    total: entries.reduce((sum, entry) => sum + entry.points, 0),
    entries,
  };
}

export function getVaultPoints(vaultAddress: string): VaultPoints {
  const key = lc(vaultAddress);
  const entries = readAllEntries().filter((entry) => entry.vaultAddress === key);
  return {
    vaultAddress: key,
    total: entries.reduce((sum, entry) => sum + entry.points, 0),
    entries,
  };
}

export function getLeaderboard(limit = 25): LeaderboardEntry[] {
  const totals = new Map<string, LeaderboardEntry>();
  for (const entry of readAllEntries()) {
    const current = totals.get(entry.wallet) ?? { wallet: entry.wallet, points: 0, events: 0 };
    current.points += entry.points;
    current.events++;
    totals.set(entry.wallet, current);
  }
  return [...totals.values()]
    .sort((a, b) => b.points - a.points || a.wallet.localeCompare(b.wallet))
    .slice(0, Math.max(0, limit));
}

export function getRecentPointEvents(limit = 25): PointsEntry[] {
  return [...readAllEntries()]
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .slice(0, Math.max(0, limit));
}

export function getPointsStats(): PointsStats {
  if (!state.initialized) initPointsLedger();
  return {
    ok: Boolean(state.path) && state.writable,
    path: state.path,
    writable: state.writable,
    entries: readAllEntries().length,
    lastError: state.lastError,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function utcHourKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}-${pad2(d.getUTCHours())}`;
}

function utcDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function countExistingDaily(wallet: string, type: PointType, day: string): number {
  const key = lc(wallet);
  return readAllEntries().filter(
    (entry) => entry.wallet === key && entry.type === type && utcDayKey(entry.createdAt) === day,
  ).length;
}

function slug(value: string): string {
  const out = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return out || "reason";
}

function dailyCappedAwards(
  entries: PointsEntry[],
  type: PointType,
  cap: number,
): PointsEntry[] {
  const counts = new Map<string, number>();
  const out: PointsEntry[] = [];
  for (const entry of entries) {
    const day = utcDayKey(entry.createdAt);
    const key = `${entry.wallet}:${day}`;
    const seen = counts.get(key) ?? countExistingDaily(entry.wallet, type, day);
    if (seen >= cap) continue;
    counts.set(key, seen + 1);
    out.push(entry);
  }
  return out;
}

export function computeActiveVaultHourAwards(
  vaults: ActiveVaultCandidate[],
  options: ActiveVaultHourOptions = {},
): PointsEntry[] {
  const now = options.now ?? Date.now();
  const minTvlUsd = options.minTvlUsd ?? DEFAULT_ACTIVE_VAULT_MIN_TVL_USD;
  const hour = utcHourKey(now);
  const activeByWallet = new Map<string, ActiveVaultCandidate>();
  for (const vault of vaults) {
    const wallet = lc(vault.wallet);
    const tvl = vault.totalValueUsd ?? vault.tvlUsd ?? 0;
    const active = vault.active !== false && !vault.paused && !vault.killed && tvl > minTvlUsd;
    if (!active || activeByWallet.has(wallet)) continue;
    activeByWallet.set(wallet, vault);
  }
  const awards = [...activeByWallet.entries()].flatMap(([wallet, vault]) => {
    const uniqueKey = `active-hour:${wallet}:${hour}`;
    if (hasAwardedUnique(uniqueKey)) return [];
    return [
      createPointsEntry({
        uniqueKey,
        wallet,
        vaultAddress: vault.vaultAddress,
        type: "active_vault_hour",
        points: POINTS_RULES.active_vault_hour,
        reason: "Active vault hour",
        createdAt: now,
      }),
    ];
  });
  return dailyCappedAwards(awards, "active_vault_hour", 24);
}

export function computeExecutionAwards(executions: ExecutionAwardCandidate[]): PointsEntry[] {
  const awards = executions.flatMap((execution) => {
    const vault = lc(execution.vaultAddress);
    const txHash = lc(execution.txHash);
    const uniqueKey = `execution:${vault}:${execution.logIndex}:${txHash}`;
    if (hasAwardedUnique(uniqueKey)) return [];
    return [
      createPointsEntry({
        uniqueKey,
        wallet: execution.wallet,
        vaultAddress: vault,
        type: "verified_execution",
        points: POINTS_RULES.verified_execution,
        reason: "Verified on-chain execution",
        txHash,
        logIndex: execution.logIndex,
        createdAt: execution.timestamp ?? Date.now(),
      }),
    ];
  });
  return dailyCappedAwards(awards, "verified_execution", 10);
}

export function computeBlockedActionAwards(blockedActions: BlockedActionAwardCandidate[]): PointsEntry[] {
  const awards = blockedActions.flatMap((blocked) => {
    if (blocked.safe !== true) return [];
    const vault = lc(blocked.vaultAddress);
    const marker = lc(blocked.hash ?? blocked.txHash ?? String(blocked.timestamp));
    const reasonSlug = slug(blocked.reason);
    const uniqueKey = `blocked:${vault}:${marker}:${reasonSlug}`;
    if (hasAwardedUnique(uniqueKey)) return [];
    return [
      createPointsEntry({
        uniqueKey,
        wallet: blocked.wallet,
        vaultAddress: vault,
        type: "safe_blocked_action",
        points: POINTS_RULES.safe_blocked_action,
        reason: blocked.reason,
        txHash: blocked.txHash,
        createdAt: blocked.timestamp,
      }),
    ];
  });
  return dailyCappedAwards(awards, "safe_blocked_action", 10);
}

export function buildManualUniqueKey(
  type: PointType,
  wallet: string,
  points: number,
  reason: string,
): string {
  return `manual:${type}:${lc(wallet)}:${points}:${slug(reason)}`;
}
