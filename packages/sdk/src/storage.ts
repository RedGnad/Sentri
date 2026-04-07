import { ethers } from "ethers";
import { Indexer, Batcher, KvClient, FixedPriceFlow__factory } from "@0gfoundation/0g-ts-sdk";
import type { FixedPriceFlow } from "@0gfoundation/0g-ts-sdk";
import { CHAIN, STORAGE } from "./constants.js";

// Stream IDs for our KV namespaces (derived deterministically)
const STATE_STREAM_ID = ethers.keccak256(ethers.toUtf8Bytes("sentri:portfolio-state"));
const AUDIT_STREAM_ID = ethers.keccak256(ethers.toUtf8Bytes("sentri:audit-log"));

let _indexer: Indexer | null = null;
let _signer: ethers.Wallet | null = null;
let _flowContract: FixedPriceFlow | null = null;

/**
 * Initialize the 0G Storage client.
 */
export function initStorage(privateKey: string): void {
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

// ── KV Storage (Portfolio State) ──────────────────────────────────────────

function encodeKey(key: string): Uint8Array {
  return Uint8Array.from(Buffer.from(key, "utf-8"));
}

function encodeValue(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(JSON.stringify(value), "utf-8"));
}

/**
 * Write a key-value pair to 0G Storage KV (portfolio state).
 */
export async function writeState(key: string, value: unknown): Promise<{ txHash: string; rootHash: string } | null> {
  const indexer = getIndexer();
  const [nodes, nodesErr] = await indexer.selectNodes(1);
  if (nodesErr !== null) {
    throw new Error(`Failed to select storage nodes: ${nodesErr}`);
  }

  const batcher = new Batcher(1, nodes, getFlowContract(), CHAIN.rpcUrl);
  batcher.streamDataBuilder.set(STATE_STREAM_ID, encodeKey(key), encodeValue(value));

  const [result, execErr] = await batcher.exec();
  if (execErr !== null) {
    throw new Error(`Failed to write state: ${execErr}`);
  }

  return result;
}

/**
 * Read a value from 0G Storage KV.
 */
export async function readState<T = unknown>(key: string, kvNodeUrl: string): Promise<T | null> {
  const kvClient = new KvClient(kvNodeUrl);
  const keyBytes = encodeKey(key);

  try {
    const val = await kvClient.getValue(STATE_STREAM_ID, keyBytes);
    if (!val) return null;
    return JSON.parse(val.toString()) as T;
  } catch {
    return null;
  }
}

// ── Audit Log (Immutable Trail) ───────────────────────────────────────────

export interface AuditEntry {
  timestamp: number;
  action: string;
  amount: string;
  proofHash: string;
  teeAttestation: string;
  reasoning: string;
  confidence: number;
  txHash?: string;
}

/**
 * Append an entry to the immutable audit log in 0G Storage.
 * Uses timestamp as key to ensure ordering and uniqueness.
 */
export async function appendAuditLog(entry: AuditEntry): Promise<{ txHash: string; rootHash: string } | null> {
  const indexer = getIndexer();
  const [nodes, nodesErr] = await indexer.selectNodes(1);
  if (nodesErr !== null) {
    throw new Error(`Failed to select storage nodes: ${nodesErr}`);
  }

  const batcher = new Batcher(1, nodes, getFlowContract(), CHAIN.rpcUrl);
  const logKey = `audit:${entry.timestamp}`;
  batcher.streamDataBuilder.set(AUDIT_STREAM_ID, encodeKey(logKey), encodeValue(entry));

  const [result, execErr] = await batcher.exec();
  if (execErr !== null) {
    throw new Error(`Failed to append audit log: ${execErr}`);
  }

  return result;
}

/**
 * Read a specific audit entry by timestamp.
 */
export async function readAuditEntry(timestamp: number, kvNodeUrl: string): Promise<AuditEntry | null> {
  return readState<AuditEntry>(`audit:${timestamp}`, kvNodeUrl);
}

// ── Portfolio State Helpers ───────────────────────────────────────────────

export interface PortfolioState {
  vaultBalance: string;
  highWaterMark: string;
  lastAction: string;
  lastActionTime: number;
  totalExecutions: number;
  pnlBps: number;
}

/**
 * Save full portfolio snapshot to 0G Storage KV.
 */
export async function savePortfolioState(state: PortfolioState): Promise<{ txHash: string; rootHash: string } | null> {
  return writeState("portfolio:current", state);
}

/**
 * Load portfolio snapshot from 0G Storage KV.
 */
export async function loadPortfolioState(kvNodeUrl: string): Promise<PortfolioState | null> {
  return readState<PortfolioState>("portfolio:current", kvNodeUrl);
}
