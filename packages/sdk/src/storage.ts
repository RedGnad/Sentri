import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import { Indexer, Batcher, KvClient, FixedPriceFlow__factory, MemData } from "@0gfoundation/0g-ts-sdk";
import type { FixedPriceFlow } from "@0gfoundation/0g-ts-sdk";
import { CHAIN, STORAGE } from "./constants.js";
import { writeRejection, makeRejectionId, type RejectionEntry as LedgerRejectionEntry } from "./rejections-ledger.js";

// Local cache mirror, namespaced by vault address. The 0G Storage write
// remains the verifiable source of truth (proof tx is included in cached
// entries). The cache layer is what the agent server reads to expose
// /vault/:address/state and /vault/:address/audit endpoints — fast reads
// without re-fetching from 0G Storage every time.
const CACHE_DIR = process.env.SENTRI_CACHE_DIR ?? "/tmp/sentri-cache";
const KV_READ_TIMEOUT_MS = Number(process.env.STORAGE_KV_READ_TIMEOUT_MS ?? "5000");
const KV_WRITE_TIMEOUT_MS = Number(process.env.STORAGE_KV_WRITE_TIMEOUT_MS ?? "60000");
const BLOB_DOWNLOAD_TIMEOUT_MS = Number(process.env.STORAGE_BLOB_DOWNLOAD_TIMEOUT_MS ?? "10000");
const BLOB_UPLOAD_TIMEOUT_MS = Number(process.env.STORAGE_BLOB_UPLOAD_TIMEOUT_MS ?? "90000");
const BLOB_DOWNLOAD_RETRIES = Number(process.env.STORAGE_BLOB_DOWNLOAD_RETRIES ?? "2");
const BLOB_DOWNLOAD_RETRY_DELAY_MS = Number(process.env.STORAGE_BLOB_DOWNLOAD_RETRY_DELAY_MS ?? "1000");
const BLOB_UPLOAD_VERIFY_RETRIES = Number(process.env.STORAGE_BLOB_UPLOAD_VERIFY_RETRIES ?? "3");
const BLOB_UPLOAD_VERIFY_RETRY_DELAY_MS = Number(process.env.STORAGE_BLOB_UPLOAD_VERIFY_RETRY_DELAY_MS ?? "1500");

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

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonFile(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

function unlinkIfExists(file: string): void {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // Best-effort cache cleanup only.
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

function inferenceStreamId(vaultAddr: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`sentri:inference:${vaultAddr.toLowerCase()}`));
}

function inferenceKey(vaultAddr: string, intentHash: string): string {
  return `inference:${vaultAddr.toLowerCase()}:${intentHash.toLowerCase()}`;
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
  if (value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
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
  amountIn?: string;
  amountOut?: string;
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
  decision?: unknown;
  reasoning: string;
  amountBps?: number;
  ruleId?: string;
  confidence: number;
  txHash?: string;
  marketPrice?: number;
  marketSource?: string;
  marketSpreadPct?: number;
  marketSourceCount?: number;
  marketRequiredSourceCount?: number;
  marketRawSources?: Array<{ source: string; priceUsd?: number; ethUsd: number }>;
  priceAttestationPayload?: unknown;
  agent?: string;
  AgentINFT?: string;
  oracleMode?: string;
  pythPriceId?: string;
  pythPrice?: string;
  pythPublishTime?: number;
  pythConfBps?: number;
  confidenceBps?: number;
  plannedAction?: string;
  executionLogCount?: number;
  preTxRootHash?: string;
  preTxStorageTxHash?: string;
  storageError?: string;
  canonicalRootHash?: string;
  canonicalStorageTxHash?: string;
  canonicalRecordHash?: string;
  kvIndexRootHash?: string;
  kvIndexTxHash?: string;
  canonicalStorageError?: string;
  kvIndexError?: string;
  externalSignals?: ExternalSignal[];
}

export interface ExternalSignal {
  provider: string;
  skillId?: string;
  action: string;
  amountBps: number;
  confidence: number;
  reason: string;
  receiptVerified: boolean;
  receiptRootHash: string;
  receiptStorageScanUrl: string;
  receiptVerification?: {
    valid: boolean;
    inputHashOk: boolean;
    outputHashOk: boolean;
    teeVerified: boolean;
  } | null;
  callTs: number;
  relation?: string;
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

export interface InferenceRecord {
  schema: "sentri.inference.v1";
  timestamp: number;
  vaultAddress: string;
  vault?: string;
  agent?: string;
  logIndex: number;
  action: string;
  amount: string;
  amountIn: string;
  amountOut?: string;
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
  decision?: unknown;
  reasoning: string;
  amountBps?: number;
  ruleId?: string;
  confidence: number;
  txHash?: string;
  marketPrice?: number;
  marketSource?: string;
  marketSpreadPct?: number;
  marketSourceCount?: number;
  marketRequiredSourceCount?: number;
  marketRawSources?: Array<{ source: string; priceUsd?: number; ethUsd: number }>;
  priceAttestationPayload?: unknown;
  AgentINFT?: string;
  oracleMode?: string;
  pythPriceId?: string;
  pythPrice?: string;
  pythPublishTime?: number;
  pythConfBps?: number;
  confidenceBps?: number;
  plannedAction?: string;
  executionLogCount?: number;
  preTxRootHash?: string;
  preTxStorageTxHash?: string;
  kvTxHash?: string;
  kvRootHash?: string;
  externalSignals?: ExternalSignal[];
}

function isRecoverableInferenceBlob(value: unknown, expectedIntentHash: string): boolean {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  const entry = raw.entry && typeof raw.entry === "object"
    ? raw.entry as Record<string, unknown>
    : raw;
  const intentHash = typeof entry.intentHash === "string" ? entry.intentHash : null;
  const reasoning = typeof entry.reasoning === "string" ? entry.reasoning : null;
  return Boolean(
    intentHash &&
      intentHash.toLowerCase() === expectedIntentHash.toLowerCase() &&
      reasoning &&
      reasoning.trim().length > 0,
  );
}

export async function saveInferenceRecord(
  vaultAddr: string,
  record: InferenceRecord,
): Promise<{ txHash: string; rootHash: string }> {
  // Upload the inference record (which carries the TEE reasoning) as a plain,
  // downloadable JSON blob. The returned rootHash is retrievable by the audit
  // read path with no KV node — it is what the durable audit index points at.
  const blob = await uploadJsonRecord(record, "sentri:inference:v1");
  if (!blob) throw new Error("0G Storage inference blob upload returned no result");
  const verifiedBlob = await downloadAuditRecordBlob(blob.rootHash, {
    forceRefresh: true,
    retries: BLOB_UPLOAD_VERIFY_RETRIES,
    retryDelayMs: BLOB_UPLOAD_VERIFY_RETRY_DELAY_MS,
  });
  if (!isRecoverableInferenceBlob(verifiedBlob, record.intentHash)) {
    throw new Error(`0G Storage inference blob ${blob.rootHash} was not recoverable after upload`);
  }
  const stored: InferenceRecord = {
    ...record,
    kvTxHash: blob.txHash,
    kvRootHash: blob.rootHash,
  };
  writeCacheFile(
    path.join("vaults", vaultAddr.toLowerCase(), "inference", `${record.intentHash.toLowerCase()}.json`),
    stored,
  );
  return blob;
}

export function readInferenceRecordFromCache(
  vaultAddr: string,
  intentHash: string,
): InferenceRecord | null {
  const file = path.join(
    vaultDir(vaultAddr),
    "inference",
    `${intentHash.toLowerCase()}.json`,
  );
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as InferenceRecord;
  } catch {
    return null;
  }
}

export async function readInferenceRecord(
  vaultAddr: string,
  intentHash: string,
): Promise<InferenceRecord | null> {
  const cached = readInferenceRecordFromCache(vaultAddr, intentHash);
  if (cached) return cached;
  return _readKv<InferenceRecord>(
    inferenceStreamId(vaultAddr),
    inferenceKey(vaultAddr, intentHash),
    STORAGE.kvNodeUrl,
  );
}

export async function readAuditEntry(
  vaultAddr: string,
  entry: Pick<AuditEntry, "txHash" | "logIndex" | "intentHash">,
  kvNodeUrl = STORAGE.kvNodeUrl,
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

const DEFAULT_AUDIT_RECOVERY_RECORDS: AuditRecoveryRecord[] = [
  {
    rootHash: "0x537c8a51055496bd2df34e6976ab5f11e849cd501ce689a05ae063057eb9f9ca",
    txHash: "0x34cfe5b5d7843f9e18c2bb0b5325aa01af569cb76e93afed35b2a5b9b67a61c0",
    referenceTxHash: "0x4b44c5063ca3b7f618a6dab5c20e840cb7d605e761162b6fbe847995df3d9ac4",
  },
  {
    rootHash: "0x71a0a3723e089a2ebb44e5b76e78aae9cb02cacf5a96275663e49ad48f24a08d",
    referenceTxHash: "0x68b8de37976587a18a0cefb7f97ffe348e3ee1cadf4db3cfa99be7b2cb9bb894",
  },
  {
    rootHash: "0x06cf6c24ce1eeccb6091bef0b7d888d92f6765a3dd74337e2051e3df3334a060",
    txHash: "0x6e8876a529de615bd2cb2f759eee5a375e15083c122718b953797e97751db2f8",
    referenceTxHash: "0x7702193a46aff156fd24d125c86c2369fcdda7803d7271227a44ec76786a9784",
  },
  {
    rootHash: "0x23debac69cad09cf1c754428ef5fbe3e26ba4dc51e8933e9d984a92efeea60f8",
    referenceTxHash: "0x8d199f655c99e43d9c9f5cf4d3b2ca03590fe74bcf1bebf8a20258fd9e08fbe4",
  },
];

function auditRecoveryRecords(): AuditRecoveryRecord[] {
  const raw = process.env.SENTRI_AUDIT_RECOVERY_RECORDS;
  let configured: AuditRecoveryRecord[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        configured = parsed.filter((record): record is AuditRecoveryRecord => {
          return Boolean(record && typeof record === "object" && typeof (record as AuditRecoveryRecord).rootHash === "string");
        });
      }
    } catch {
      configured = [];
    }
  }
  const byRoot = new Map<string, AuditRecoveryRecord>();
  for (const record of [...DEFAULT_AUDIT_RECOVERY_RECORDS, ...configured]) {
    byRoot.set(record.rootHash.toLowerCase(), record);
  }
  return Array.from(byRoot.values());
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
      let canonical: CanonicalAuditRecord | null = null;
      for (let attempt = 0; attempt < 2 && !canonical; attempt++) {
        if (!fs.existsSync(file)) {
          const err = await getIndexer().download(record.rootHash, file, false);
          if (err !== null) break;
        }
        try {
          canonical = JSON.parse(fs.readFileSync(file, "utf-8")) as CanonicalAuditRecord;
        } catch {
          try { fs.unlinkSync(file); } catch {}
        }
      }
      if (!canonical) continue;
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
  const [nodes, nodesErr] = await withTimeout(
    indexer.selectNodes(1),
    KV_WRITE_TIMEOUT_MS,
    "0G Storage node selection",
  );
  if (nodesErr !== null) {
    throw new Error(`Failed to select storage nodes: ${nodesErr}`);
  }

  const batcher = new Batcher(1, nodes, getFlowContract(), CHAIN.rpcUrl);
  batcher.streamDataBuilder.set(streamId, encodeKey(key), encodeValue(value));

  const execOpts = STORAGE.submitFeeWei > 0n ? { fee: STORAGE.submitFeeWei } : undefined;
  const [result, execErr] = await withTimeout(
    batcher.exec(execOpts),
    KV_WRITE_TIMEOUT_MS,
    "0G Storage KV write",
  );
  if (execErr !== null) {
    throw new Error(`Failed to write to 0G Storage: ${execErr}`);
  }
  return result;
}

/**
 * Upload any JSON-serializable value to 0G Storage as a plain blob. Unlike a
 * KV write, the returned rootHash can be downloaded directly via the indexer
 * with NO KV node — this is the retrieval path the durable audit index relies
 * on. Throws on failure so callers can fail closed.
 */
export async function uploadJsonRecord(
  value: unknown,
  tag: string,
): Promise<{ txHash: string; rootHash: string } | null> {
  const bytes = Uint8Array.from(Buffer.from(canonicalJson(value), "utf-8"));
  const file = new MemData(bytes);
  const [, treeErr] = await file.merkleTree();
  if (treeErr !== null) {
    throw new Error(`0G Storage Merkle tree error: ${treeErr}`);
  }
  const uploadOpts = STORAGE.submitFeeWei > 0n
    ? { fee: STORAGE.submitFeeWei, tags: ethers.toUtf8Bytes(tag) }
    : { tags: ethers.toUtf8Bytes(tag) };
  const [result, err] = await withTimeout(
    getIndexer().upload(file, CHAIN.rpcUrl, getSigner(), uploadOpts),
    BLOB_UPLOAD_TIMEOUT_MS,
    "0G Storage blob upload",
  );
  if (err !== null) {
    throw new Error(`Failed to upload JSON record to 0G Storage: ${err}`);
  }
  if (!result) return null;
  if ("txHash" in result) return result;
  return {
    txHash: result.txHashes[0],
    rootHash: result.rootHashes[0],
  };
}

async function _uploadCanonicalBlob(
  record: CanonicalAuditRecord,
): Promise<{ txHash: string; rootHash: string } | null> {
  return uploadJsonRecord(record, "sentri:audit:v1");
}

/**
 * Download a JSON blob from 0G Storage by rootHash via the indexer (no KV
 * node). Used by the audit read path once the durable index has resolved a
 * rootHash. Returns null if the blob is unavailable or unparseable.
 */
export async function downloadAuditRecordBlob(
  rootHash: string,
  options: { forceRefresh?: boolean; retries?: number; retryDelayMs?: number } = {},
): Promise<unknown | null> {
  const file = path.join(CACHE_DIR, "recovery", `${rootHash}.json`);
  const retries = Math.max(0, options.retries ?? BLOB_DOWNLOAD_RETRIES);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? BLOB_DOWNLOAD_RETRY_DELAY_MS);
  ensureDir(path.dirname(file));

  if (!options.forceRefresh && fs.existsSync(file)) {
    const cached = readJsonFile(file);
    if (cached !== null) return cached;
    unlinkIfExists(file);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const tmp = `${file}.${process.pid}.${Date.now()}.${attempt}.tmp`;
    try {
      unlinkIfExists(tmp);
      const err = await withTimeout(
        getIndexer().download(rootHash, tmp, false),
        BLOB_DOWNLOAD_TIMEOUT_MS,
        "0G Storage blob download",
      );
      if (err === null) {
        const parsed = readJsonFile(tmp);
        if (parsed !== null) {
          unlinkIfExists(file);
          fs.renameSync(tmp, file);
          return parsed;
        }
      }
    } catch {
      // Retry below. A failed/partial download must not poison the cache.
    } finally {
      unlinkIfExists(tmp);
    }
    if (attempt < retries && retryDelayMs > 0) {
      await sleep(retryDelayMs);
    }
  }
  return null;
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
    const val = await withTimeout(
      kvClient.getValue(streamId, encodedKey),
      KV_READ_TIMEOUT_MS,
      "0G Storage KV read",
    );
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
  type: "defensive-override" | "onchain-revert" | "agent-sizing" | "tee-signer-mismatch" | "audit-storage";
  phase?: "state-read" | "estimateGas" | "executeStrategy";
  reason: string;
  errorCode?: string;
  action?: string;
  intentHash?: string;
  txHash?: string;
  priceAgeSec?: number;
  maxPriceStaleness?: number;
  safeNoFundsMoved?: boolean;
  verdict?: string;
  vaultAddress: string;
  kvTxHash?: string;
  kvRootHash?: string;
}

function rejectionManifestKey(vaultAddr: string): string {
  return `rejection:manifest:${vaultAddr.toLowerCase()}`;
}

// ── Durable ledger conversion helpers ────────────────────────────────────

const HUMAN_REASON_BY_CODE: Record<string, string> = {
  InsufficientAmountOut: "Swap output fell below the slippage-protected minimum.",
  CooldownNotElapsed: "Strategy execution is in cooldown — too soon since the last trade.",
  AllocationExceeded: "Trade would exceed the vault's maximum allocation policy.",
  DrawdownBreached: "Trade would breach the vault's maximum drawdown policy.",
  PriceStale: "Oracle price was too old — trade blocked to protect against stale market data.",
  VaultKilled: "Vault has been killed by the operator.",
  InvalidTEESignature: "TEE signature did not match the expected signer.",
};

const HUMAN_REASON_BY_TYPE: Record<string, string> = {
  "defensive-override": "The agent's decision was rejected by the defensive verifier.",
  "tee-signer-mismatch": "TEE signer is not bound to the active AgentINFT.",
  "audit-storage": "Audit storage is unhealthy — execution blocked for data integrity.",
  "agent-sizing": "Agent computed a position size outside the safe range.",
};

function toDurablePhase(
  phase: "state-read" | "estimateGas" | "executeStrategy" | undefined,
  txHash: string | undefined,
): LedgerRejectionEntry["phase"] {
  if (phase === "executeStrategy" || (phase === undefined && txHash)) return "execution";
  if (phase === "estimateGas") return "estimate";
  return "preflight";
}

function toLedgerEntry(vaultAddr: string, entry: RejectionEntry): LedgerRejectionEntry {
  const humanReason =
    (entry.errorCode ? HUMAN_REASON_BY_CODE[entry.errorCode] : undefined) ??
    HUMAN_REASON_BY_TYPE[entry.type] ??
    entry.reason;
  return {
    id: makeRejectionId(vaultAddr, entry.timestamp, entry.type, entry.errorCode),
    vaultAddress: vaultAddr.toLowerCase(),
    phase: toDurablePhase(entry.phase, entry.txHash),
    action: entry.action ?? "unknown",
    reason: entry.reason,
    humanReason,
    txSent: !!entry.txHash,
    fundsMoved: false,
    intentHash: entry.intentHash,
    createdAt: entry.timestamp,
  };
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
  // Also persist to durable JSONL ledger (survives Render restarts).
  writeRejection(toLedgerEntry(vaultAddr, entry));
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
