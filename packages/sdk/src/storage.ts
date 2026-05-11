import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import { Indexer, Batcher, KvClient, FixedPriceFlow__factory, MemData } from "@0gfoundation/0g-ts-sdk";
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

function auditManifestKey(vaultAddr: string): string {
  return `audit:manifest:${vaultAddr.toLowerCase()}`;
}

function rejectionStreamId(vaultAddr: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`sentri:rejections:${vaultAddr.toLowerCase()}`));
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

function getSigner(): ethers.Wallet {
  if (!_signer) throw new Error("Storage not initialized. Call initStorage() first.");
  return _signer;
}

// ── Encoding helpers ──────────────────────────────────────────────────────

function encodeKey(key: string): Uint8Array {
  return Uint8Array.from(Buffer.from(key, "utf-8"));
}

function encodeValue(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(JSON.stringify(value), "utf-8"));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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
  rawResponseHash?: string;
  signedPayloadHash?: string;
  modelResponse?: string;
  signedResponse: string;
  teeSignature: string;
  teeSigner: string;
  recoveredSigner?: string;
  expectedSigner?: string;
  signerMatchedProvider?: boolean;
  teeAttestation: string;
  deadline: number;
  processResponseVerified?: true;
  verified: true;
  provider: string;
  providerEndpoint?: string;
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
  marketRequiredSourceCount?: number;
  marketRawSources?: Array<{ source: string; ethUsd: number }>;
  priceAttestationPayload?: unknown;
  storageError?: string;
  canonicalRootHash?: string;
  canonicalStorageTxHash?: string;
  canonicalRecordHash?: string;
  kvIndexRootHash?: string;
  kvIndexTxHash?: string;
  canonicalStorageError?: string;
  kvIndexError?: string;
}

export interface CanonicalAuditRecord {
  schema: "sentri.audit.v1";
  chainId: number;
  vault: string;
  key: string;
  recordedAt: number;
  entry: AuditEntry;
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
  const cachePath = path.join("vaults", vaultAddr.toLowerCase(), "audit", `${entry.timestamp}.json`);
  writeCacheFile(cachePath, entry);
  const canonicalRecord: CanonicalAuditRecord = {
    schema: "sentri.audit.v1",
    chainId: CHAIN.id,
    vault: vaultAddr.toLowerCase(),
    key: logKey,
    recordedAt: Date.now(),
    entry,
  };
  const canonicalRecordHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalJson(canonicalRecord)));
  let canonicalResult: { txHash: string; rootHash: string } | null = null;
  let kvResult: { txHash: string; rootHash: string } | null = null;
  let canonicalStorageError: string | undefined;
  let kvIndexError: string | undefined;
  try {
    canonicalResult = await _uploadCanonicalBlob(canonicalRecord);
  } catch (err) {
    canonicalStorageError = err instanceof Error ? err.message : String(err);
  }
  const indexedEntry: AuditEntry = {
    ...entry,
    canonicalRootHash: canonicalResult?.rootHash,
    canonicalStorageTxHash: canonicalResult?.txHash,
    canonicalRecordHash,
    canonicalStorageError,
  };
  try {
    kvResult = await _writeKv(auditStreamId(vaultAddr), logKey, indexedEntry);
    indexedEntry.kvIndexRootHash = kvResult?.rootHash;
    indexedEntry.kvIndexTxHash = kvResult?.txHash;
  } catch (err) {
    kvIndexError = err instanceof Error ? err.message : String(err);
    indexedEntry.kvIndexError = kvIndexError;
  }
  // Update the KV audit manifest so we can reconstruct the list after a cache wipe.
  try {
    const manifestKey = auditManifestKey(vaultAddr);
    const existing = await _readKv<string[]>(auditStreamId(vaultAddr), manifestKey, STORAGE.kvNodeUrl);
    const manifest: string[] = existing ?? [];
    if (!manifest.includes(logKey)) {
      manifest.push(logKey);
      // Keep only the 200 most recent keys to cap KV manifest size.
      const trimmed = manifest.slice(-200);
      await _writeKv(auditStreamId(vaultAddr), manifestKey, trimmed);
    }
  } catch {
    // Non-fatal: manifest update failure does not block the audit write.
  }
  writeCacheFile(cachePath, {
    ...indexedEntry,
    storageTxHash: canonicalResult?.txHash ?? kvResult?.txHash,
    storageRootHash: canonicalResult?.rootHash ?? kvResult?.rootHash,
    storageError: canonicalStorageError ?? kvIndexError,
  });
  return canonicalResult ?? kvResult;
}

export async function readAuditEntry(
  vaultAddr: string,
  entry: Pick<AuditEntry, "txHash" | "logIndex" | "intentHash">,
  kvNodeUrl: string,
): Promise<AuditEntry | null> {
  return _readKv<AuditEntry>(auditStreamId(vaultAddr), auditKey(vaultAddr, entry), kvNodeUrl);
}

/**
 * Reconstruct cached audit entries from 0G Storage KV using the persisted
 * manifest of keys. Used as a fallback when the local cache is wiped
 * (e.g. Render restart on a /tmp filesystem).
 */
export async function readAuditFromKv(
  vaultAddr: string,
  limit = 50,
): Promise<CachedAuditEntry[]> {
  const manifestKey = auditManifestKey(vaultAddr);
  const keys = await _readKv<string[]>(auditStreamId(vaultAddr), manifestKey, STORAGE.kvNodeUrl);
  if (!keys || keys.length === 0) return [];
  const recent = keys.slice(-limit).reverse();
  const entries = await Promise.all(
    recent.map((key) =>
      _readKv<CachedAuditEntry>(auditStreamId(vaultAddr), key, STORAGE.kvNodeUrl),
    ),
  );
  return entries.filter((e): e is CachedAuditEntry => e !== null);
}

interface AuditRecoveryRecord {
  rootHash: string;
  txHash?: string;
  referenceTxHash?: string;
  kvIndexRootHash?: string;
  kvIndexTxHash?: string;
}

function auditRecoveryRecords(): AuditRecoveryRecord[] {
  const raw = process.env.SENTRI_AUDIT_RECOVERY_RECORDS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((record): record is AuditRecoveryRecord => {
      return Boolean(record && typeof record === "object" && typeof (record as AuditRecoveryRecord).rootHash === "string");
    });
  } catch {
    return [];
  }
}

export async function readAuditFromRecoveryRecords(
  vaultAddr: string,
  limit = 50,
): Promise<CachedAuditEntry[]> {
  const records = auditRecoveryRecords().slice(-limit);
  if (records.length === 0) return [];
  const entries: CachedAuditEntry[] = [];
  for (const record of records) {
    try {
      const file = path.join(CACHE_DIR, "recovery", `${record.rootHash}.json`);
      ensureDir(path.dirname(file));
      const err = await getIndexer().download(record.rootHash, file, false);
      if (err !== null) continue;
      const canonical = JSON.parse(fs.readFileSync(file, "utf-8")) as CanonicalAuditRecord;
      if (canonical.vault.toLowerCase() !== vaultAddr.toLowerCase()) continue;
      const cached: CachedAuditEntry = {
        ...canonical.entry,
        canonicalRootHash: record.rootHash,
        canonicalStorageTxHash: record.txHash ?? canonical.entry.canonicalStorageTxHash,
        txHash: canonical.entry.txHash || record.referenceTxHash,
        canonicalRecordHash: ethers.keccak256(ethers.toUtf8Bytes(canonicalJson(canonical))),
        kvIndexRootHash: record.kvIndexRootHash,
        kvIndexTxHash: record.kvIndexTxHash,
        storageRootHash: record.rootHash,
        storageTxHash: record.txHash,
      };
      writeCacheFile(path.join("vaults", vaultAddr.toLowerCase(), "audit", `${cached.timestamp}.json`), cached);
      entries.push(cached);
    } catch {
      continue;
    }
  }
  return entries.sort((a, b) => b.timestamp - a.timestamp);
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

  const execOpts = STORAGE.submitFeeWei > 0n ? { fee: STORAGE.submitFeeWei } : undefined;
  const [result, execErr] = await batcher.exec(execOpts);
  if (execErr !== null) {
    throw new Error(`Failed to write to 0G Storage: ${execErr}`);
  }
  return result;
}

async function _uploadCanonicalBlob(
  record: CanonicalAuditRecord,
): Promise<{ txHash: string; rootHash: string } | null> {
  const bytes = Uint8Array.from(Buffer.from(canonicalJson(record), "utf-8"));
  const file = new MemData(bytes);
  const [, treeErr] = await file.merkleTree();
  if (treeErr !== null) {
    throw new Error(`Canonical audit Merkle tree error: ${treeErr}`);
  }
  const uploadOpts = STORAGE.submitFeeWei > 0n
    ? { fee: STORAGE.submitFeeWei, tags: ethers.toUtf8Bytes("sentri:audit:v1") }
    : { tags: ethers.toUtf8Bytes("sentri:audit:v1") };
  const [result, err] = await getIndexer().upload(file, CHAIN.rpcUrl, getSigner(), uploadOpts);
  if (err !== null) {
    throw new Error(`Failed to upload canonical audit record to 0G Storage: ${err}`);
  }
  if (!result) return null;
  if ("txHash" in result) return result;
  return {
    txHash: result.txHashes[0],
    rootHash: result.rootHashes[0],
  };
}

async function _readKv<T = unknown>(
  streamId: string,
  key: string,
  kvNodeUrl: string,
): Promise<T | null> {
  const kvClient = new KvClient(kvNodeUrl);
  const keyBytes = encodeKey(key);
  const encodedKey = ethers.encodeBase64(keyBytes) as unknown as Uint8Array;
  try {
    const val = await kvClient.getValue(streamId, encodedKey);
    if (!val) return null;
    const raw = typeof val === "object" && "data" in val
      ? Buffer.from(String((val as { data: string }).data), "base64").toString("utf-8")
      : String(val);
    return JSON.parse(raw) as T;
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
  canonicalRootHash?: string;
  canonicalStorageTxHash?: string;
  canonicalRecordHash?: string;
  kvIndexRootHash?: string;
  kvIndexTxHash?: string;
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

// ── Rejection log (blocked unsafe actions) ──────────────────────────────

export interface RejectionEntry {
  timestamp: number;
  type: "defensive-override" | "onchain-revert" | "agent-sizing";
  reason: string;
  errorCode?: string;
  action?: string;
  intentHash?: string;
  vaultAddress: string;
  kvTxHash?: string;
  kvRootHash?: string;
}

function rejectionManifestKey(vaultAddr: string): string {
  return `rejection:manifest:${vaultAddr.toLowerCase()}`;
}

/**
 * Persist a blocked-action entry to KV and local cache.
 * Captures the KV tx/root hash and maintains a manifest for recovery after
 * cache wipe — same pattern as the canonical audit log.
 */
export function appendRejectionLog(
  vaultAddr: string,
  entry: RejectionEntry,
): void {
  const key = `rejection:${vaultAddr.toLowerCase()}:${entry.timestamp}:${entry.type}`;
  void (async () => {
    try {
      const result = await _writeKv(rejectionStreamId(vaultAddr), key, entry);
      entry.kvTxHash = result?.txHash;
      entry.kvRootHash = result?.rootHash;
      // Update manifest with this key so we can recover after cache wipe.
      const manifestStreamId = rejectionStreamId(vaultAddr);
      const manifest = await _readKv(manifestStreamId, rejectionManifestKey(vaultAddr), STORAGE.kvNodeUrl);
      const keys: string[] = Array.isArray(manifest) ? (manifest as string[]) : [];
      keys.push(key);
      await _writeKv(manifestStreamId, rejectionManifestKey(vaultAddr), keys);
    } catch {
      // Non-fatal — rejection log write failure does not block the agent.
    }
  })();
  writeCacheFile(
    path.join("vaults", vaultAddr.toLowerCase(), "rejections", `${entry.timestamp}.json`),
    entry,
  );
}

/**
 * Read rejections from KV manifest (fallback after cache wipe).
 */
export async function readRejectionsFromKv(vaultAddr: string): Promise<RejectionEntry[]> {
  try {
    const streamId = rejectionStreamId(vaultAddr);
    const manifest = await _readKv(streamId, rejectionManifestKey(vaultAddr), STORAGE.kvNodeUrl);
    if (!Array.isArray(manifest)) return [];
    const keys = manifest as string[];
    const entries = await Promise.all(
      keys.map(async (k) => {
        try {
          return (await _readKv(streamId, k, STORAGE.kvNodeUrl)) as RejectionEntry | null;
        } catch {
          return null;
        }
      }),
    );
    return entries.filter((e): e is RejectionEntry => e !== null);
  } catch {
    return [];
  }
}

export function listVaultRejectionsFromCache(vaultAddr: string, limit = 50): string[] {
  const dir = path.join(vaultDir(vaultAddr), "rejections");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort((a, b) => Number(b) - Number(a))
    .slice(0, limit);
}

export function readVaultRejectionFromCache(
  vaultAddr: string,
  timestamp: string,
): RejectionEntry | null {
  const file = path.join(vaultDir(vaultAddr), "rejections", `${timestamp}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as RejectionEntry;
  } catch {
    return null;
  }
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
