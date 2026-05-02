import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import { Indexer, Batcher, KvClient, FixedPriceFlow__factory } from "@0gfoundation/0g-ts-sdk";
import type { FixedPriceFlow } from "@0gfoundation/0g-ts-sdk";
import { CHAIN, STORAGE } from "./constants.js";

// Local cache mirror, namespaced by vault address. The 0G Storage write
// remains the verifiable source of truth (proof tx is included in cached
// entries). The cache layer is what the agent server reads to expose
// /vault/:address/state and /vault/:address/audit endpoints — fast reads
// without re-fetching from 0G Storage every time.
const CACHE_DIR = process.env.SENTRI_CACHE_DIR ?? "/tmp/sentri-cache";

function vaultDir(vaultAddr: string): string {
  return path.join(CACHE_DIR, "vaults", vaultAddr.toLowerCase());
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeCacheFile(relPath: string, data: unknown): void {
  try {
    const full = path.join(CACHE_DIR, relPath);
    ensureDir(path.dirname(full));
    fs.writeFileSync(full, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn(`[storage] cache write failed: ${err instanceof Error ? err.message : err}`);
  }
}

// 0G Storage stream IDs are derived per-vault so different vaults' data
// never collides on the storage layer either.
function stateStreamId(vaultAddr: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`sentri:portfolio-state:${vaultAddr.toLowerCase()}`));
}

function auditStreamId(vaultAddr: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`sentri:audit-log:${vaultAddr.toLowerCase()}`));
}

let _indexer: Indexer | null = null;
let _signer: ethers.Wallet | null = null;
let _flowContract: FixedPriceFlow | null = null;

/**
 * Initialize the 0G Storage client. Idempotent.
 */
export function initStorage(privateKey: string): void {
  if (_indexer && _signer && _flowContract) return;
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  _signer = new ethers.Wallet(privateKey, provider);
  _indexer = new Indexer(STORAGE.indexerUrl);
  _flowContract = FixedPriceFlow__factory.connect(STORAGE.flowContract, _signer);
}

function getIndexer(): Indexer {
  if (!_indexer) throw new Error("Storage not initialized. Call initStorage() first.");
  return _indexer;
}

function getFlowContract(): FixedPriceFlow {
  if (!_flowContract) throw new Error("Storage not initialized. Call initStorage() first.");
  return _flowContract;
}

// ── Encoding helpers ──────────────────────────────────────────────────────

function encodeKey(key: string): Uint8Array {
  return Uint8Array.from(Buffer.from(key, "utf-8"));
}

function encodeValue(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(JSON.stringify(value), "utf-8"));
}

// ── KV Storage (Portfolio State) ─────────────────────────────────────────

export interface PortfolioState {
  vaultBalance: string;
  riskBalance?: string;
  totalValue?: string;
  highWaterMark: string;
  lastAction: string;
  lastActionTime: number;
  totalExecutions: number;
  pnlBps: number;
  marketPrice?: number;
  storageError?: string;
}

/**
 * Save a per-vault portfolio snapshot to 0G Storage KV + local cache mirror.
 */
export async function savePortfolioState(
  vaultAddr: string,
  state: PortfolioState,
): Promise<{ txHash: string; rootHash: string } | null> {
  let result: { txHash: string; rootHash: string } | null = null;
  let storageError: string | undefined;
  try {
    result = await _writeKv(stateStreamId(vaultAddr), "portfolio:current", state);
  } catch (err) {
    storageError = err instanceof Error ? err.message : String(err);
  }
  writeCacheFile(path.join("vaults", vaultAddr.toLowerCase(), "state.json"), {
    ...state,
    updatedAt: Date.now(),
    storageTxHash: result?.txHash,
    storageRootHash: result?.rootHash,
    storageError,
  });
  return result;
}

export async function loadPortfolioState(
  vaultAddr: string,
  kvNodeUrl: string,
): Promise<PortfolioState | null> {
  return _readKv<PortfolioState>(stateStreamId(vaultAddr), "portfolio:current", kvNodeUrl);
}

// ── Audit entries (0G Storage KV) ────────────────────────────────────────

export interface AuditEntry {
  timestamp: number;
  logIndex: number;
  action: string;
  amount: string;
  intent: unknown;
  intentHash: string;
  responseHash: string;
  modelResponse?: string;
  signedResponse: string;
  teeSignature: string;
  teeSigner: string;
  teeAttestation: string;
  deadline: number;
  verified: true;
  provider: string;
  model: string;
  verifiability: string;
  chatID: string;
  reasoning: string;
  confidence: number;
  txHash?: string;
  marketPrice?: number;
  marketSource?: string;
  marketSpreadPct?: number;
  marketSourceCount?: number;
  marketRawSources?: Array<{ source: string; ethUsd: number }>;
  priceAttestationPayload?: unknown;
  storageError?: string;
}

export function auditKey(
  vaultAddr: string,
  entry: Pick<AuditEntry, "txHash" | "logIndex" | "intentHash">,
): string {
  const safeTx = entry.txHash ?? "pending";
  return `audit:${vaultAddr.toLowerCase()}:${safeTx}:${entry.logIndex}:${entry.intentHash}`;
}

/**
 * Append a collision-resistant, storage-backed audit entry for a vault.
 */
export async function appendAuditLog(
  vaultAddr: string,
  entry: AuditEntry,
): Promise<{ txHash: string; rootHash: string } | null> {
  const logKey = auditKey(vaultAddr, entry);
  let result: { txHash: string; rootHash: string } | null = null;
  let storageError: string | undefined;
  try {
    result = await _writeKv(auditStreamId(vaultAddr), logKey, entry);
  } catch (err) {
    storageError = err instanceof Error ? err.message : String(err);
  }
  writeCacheFile(
    path.join("vaults", vaultAddr.toLowerCase(), "audit", `${entry.timestamp}.json`),
    {
      ...entry,
      storageTxHash: result?.txHash,
      storageRootHash: result?.rootHash,
      storageError,
    },
  );
  return result;
}

export async function readAuditEntry(
  vaultAddr: string,
  entry: Pick<AuditEntry, "txHash" | "logIndex" | "intentHash">,
  kvNodeUrl: string,
): Promise<AuditEntry | null> {
  return _readKv<AuditEntry>(auditStreamId(vaultAddr), auditKey(vaultAddr, entry), kvNodeUrl);
}

// ── Internal KV primitives ───────────────────────────────────────────────

async function _writeKv(
  streamId: string,
  key: string,
  value: unknown,
): Promise<{ txHash: string; rootHash: string } | null> {
  const indexer = getIndexer();
  const [nodes, nodesErr] = await indexer.selectNodes(1);
  if (nodesErr !== null) {
    throw new Error(`Failed to select storage nodes: ${nodesErr}`);
  }

  const batcher = new Batcher(1, nodes, getFlowContract(), CHAIN.rpcUrl);
  batcher.streamDataBuilder.set(streamId, encodeKey(key), encodeValue(value));

  const [result, execErr] = await batcher.exec();
  if (execErr !== null) {
    throw new Error(`Failed to write to 0G Storage: ${execErr}`);
  }
  return result;
}

async function _readKv<T = unknown>(
  streamId: string,
  key: string,
  kvNodeUrl: string,
): Promise<T | null> {
  const kvClient = new KvClient(kvNodeUrl);
  const keyBytes = encodeKey(key);
  try {
    const val = await kvClient.getValue(streamId, keyBytes);
    if (!val) return null;
    return JSON.parse(val.toString()) as T;
  } catch {
    return null;
  }
}

// ── Cache reads (used by server endpoints to expose per-vault data) ──────

export interface CachedVaultState extends PortfolioState {
  updatedAt?: number;
  storageTxHash?: string;
  storageRootHash?: string;
}

export interface CachedAuditEntry extends AuditEntry {
  storageTxHash?: string;
  storageRootHash?: string;
}

export function readVaultStateFromCache(vaultAddr: string): CachedVaultState | null {
  const file = path.join(vaultDir(vaultAddr), "state.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as CachedVaultState;
  } catch {
    return null;
  }
}

export function readVaultAuditFromCache(
  vaultAddr: string,
  timestamp: string,
): CachedAuditEntry | null {
  const file = path.join(vaultDir(vaultAddr), "audit", `${timestamp}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as CachedAuditEntry;
  } catch {
    return null;
  }
}

export function listVaultAuditFromCache(vaultAddr: string, limit = 50): string[] {
  const dir = path.join(vaultDir(vaultAddr), "audit");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort((a, b) => Number(b) - Number(a))
    .slice(0, limit);
}

export function findClosestVaultAudit(
  vaultAddr: string,
  targetTs: number,
  windowMs = 5_000,
): string | null {
  const dir = path.join(vaultDir(vaultAddr), "audit");
  if (!fs.existsSync(dir)) return null;
  let closest: string | null = null;
  let minDelta = windowMs;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const ts = Number(f.replace(".json", ""));
    if (!Number.isFinite(ts)) continue;
    const delta = Math.abs(ts - targetTs);
    if (delta <= minDelta) {
      minDelta = delta;
      closest = String(ts);
    }
  }
  return closest;
}

export function listKnownVaultsFromCache(): string[] {
  const dir = path.join(CACHE_DIR, "vaults");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => {
    try {
      return fs.statSync(path.join(dir, d)).isDirectory();
    } catch {
      return false;
    }
  });
}
