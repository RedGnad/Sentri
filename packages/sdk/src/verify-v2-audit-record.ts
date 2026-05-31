#!/usr/bin/env tsx
/**
 * pnpm --filter @steward/sdk verify:v2-audit-record -- --tx <hash>
 *
 * Read-only verifier for the V2 audit parity contract:
 * - verifies the tx is a TrustlessOracleExecution
 * - resolves the durable audit index record
 * - downloads the 0G Storage record
 * - checks the recovered reasoning record matches the on-chain execution
 *
 * This does not claim full TEE attestation on-chain. It verifies the recoverable
 * reasoning record, hashes, signer binding, and Pyth execution evidence.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "dotenv/config";
import { Indexer } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import { AGENT_INFT_ABI, CHAIN, STORAGE } from "./constants.js";
import {
  findAuditIndexByIntentHash,
  findAuditIndexByResponseHash,
  findAuditIndexByTxHash,
  initAuditIndex,
} from "./audit-index.js";

const EXEC_EVENT_ABI = [
  "event TrustlessOracleExecution(address indexed vault, address indexed agent, bytes32 indexed intentHash, bytes32 responseHash, bytes32 pythPriceId, uint256 pythPrice, uint256 pythPublishTime, uint256 pythConfBps, uint256 amountIn, uint256 amountOut, uint256 timestamp)",
] as const;

const VAULT_ABI = [
  "function executionLogCount() view returns (uint256)",
  "function executionLogs(uint256) view returns (uint256 timestamp, uint8 action, uint256 amountIn, uint256 amountOut, uint256 tvlAfter, bytes32 intentHash, bytes32 responseHash, address teeSigner, bytes32 teeAttestation, uint256 deadline, uint256 pythPrice, uint256 pythPublishTime, uint256 pythConfBps)",
] as const;

const ACTIONS = ["Rebalance", "YieldFarm", "EmergencyDeleverage"] as const;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

interface Args {
  txHash: string;
  rootHash?: string;
}

interface FieldCheck {
  label: string;
  ok: boolean;
  detail: string;
}

function parseArgs(): Args {
  let txHash = "";
  let rootHash: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--tx") {
      txHash = argv[++i] ?? "";
    } else if (arg === "--root") {
      rootHash = argv[++i] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      txHash = "";
      break;
    }
  }
  if (!HASH_RE.test(txHash)) {
    throw new Error("Usage: verify:v2-audit-record -- --tx <0x...txHash> [--root <0x...rootHash>]");
  }
  if (rootHash && !HASH_RE.test(rootHash)) {
    throw new Error("--root must be a 32-byte 0x hash");
  }
  return { txHash, rootHash };
}

function lc(value: string): string {
  return value.toLowerCase();
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function unwrapRecord(blob: unknown): Record<string, unknown> | null {
  if (!blob || typeof blob !== "object") return null;
  const envelope = blob as Record<string, unknown>;
  if (envelope.entry && typeof envelope.entry === "object") {
    return { ...envelope, ...(envelope.entry as Record<string, unknown>) };
  }
  return envelope;
}

function add(checks: FieldCheck[], label: string, ok: boolean, detail: string): void {
  checks.push({ label, ok, detail });
}

async function downloadJson(rootHash: string): Promise<unknown> {
  const indexer = new Indexer(STORAGE.indexerUrl);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentri-v2-audit-"));
  const file = path.join(tempDir, `${rootHash}.json`);
  try {
    const err = await indexer.download(rootHash, file, false);
    if (err !== null) throw new Error(String(err));
    return JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  const receipt = await provider.getTransactionReceipt(args.txHash);
  if (!receipt) throw new Error(`tx not found: ${args.txHash}`);

  const execIface = new ethers.Interface(EXEC_EVENT_ABI);
  let event: ethers.LogDescription | null = null;
  let emitter = "";
  for (const log of receipt.logs) {
    try {
      const parsed = execIface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "TrustlessOracleExecution") {
        event = parsed;
        emitter = log.address;
        break;
      }
    } catch {
      // Not the V2 execution event.
    }
  }
  if (!event) throw new Error("no TrustlessOracleExecution event found in tx");

  const ev = event.args;
  const vaultAddress = String(ev.vault);
  const agent = String(ev.agent);
  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
  const count = (await vault.executionLogCount()) as bigint;
  let matchedLog: Awaited<ReturnType<typeof vault.executionLogs>> | null = null;
  let matchedIndex = -1;
  for (let i = count; i > 0n && i > count - 25n; ) {
    i -= 1n;
    const log = await vault.executionLogs(i);
    if (lc(String(log.intentHash)) === lc(String(ev.intentHash))) {
      matchedLog = log;
      matchedIndex = Number(i);
      break;
    }
  }
  if (!matchedLog) throw new Error("no executionLogs entry matches the tx intentHash");

  initAuditIndex();
  const indexRecord =
    findAuditIndexByTxHash(args.txHash) ??
    findAuditIndexByIntentHash(String(ev.intentHash)) ??
    findAuditIndexByResponseHash(String(ev.responseHash));
  const rootHash = args.rootHash ?? indexRecord?.rootHash;
  if (!rootHash) {
    throw new Error("no audit index record found for tx/intent/response; set AUDIT_INDEX_PATH or pass --root");
  }

  const blob = await downloadJson(rootHash);
  const record = unwrapRecord(blob);
  if (!record) throw new Error(`root ${rootHash} did not contain a JSON object`);

  const checks: FieldCheck[] = [];
  const recordVault = asString(record.vault) ?? asString(record.vaultAddress);
  const recordAgent = asString(record.agent);
  const recordAgentInft = asString(record.AgentINFT);
  const recordIntent = asString(record.intentHash);
  const recordResponse = asString(record.responseHash);
  const recordTeeSigner = asString(record.teeSigner);
  const recordTx = asString(record.txHash);
  const recordPythPriceId = asString(record.pythPriceId);
  const recordReasoning = asString(record.reasoning);
  const recordAmountIn = asString(record.amountIn);
  const recordAmountOut = asString(record.amountOut);
  const recordPythPublishTime = asNumber(record.pythPublishTime);
  const recordConfidenceBps = asNumber(record.confidenceBps) ?? asNumber(record.pythConfBps);
  const recordLogIndex = asNumber(record.logIndex);
  const recordExecutionLogCount = asNumber(record.executionLogCount);

  add(checks, "tx success", receipt.status === 1, `status=${receipt.status}`);
  add(checks, "event emitter is vault", lc(emitter) === lc(vaultAddress), emitter);
  add(checks, "schema", record.schema === "sentri.inference.v1", String(record.schema));
  add(checks, "vault", Boolean(recordVault && lc(recordVault) === lc(vaultAddress)), recordVault ?? "missing");
  add(checks, "agent", Boolean(recordAgent && lc(recordAgent) === lc(agent)), recordAgent ?? "missing");
  add(checks, "intentHash", Boolean(recordIntent && lc(recordIntent) === lc(String(ev.intentHash))), recordIntent ?? "missing");
  add(checks, "responseHash", Boolean(recordResponse && lc(recordResponse) === lc(String(ev.responseHash))), recordResponse ?? "missing");
  add(checks, "teeSigner", Boolean(recordTeeSigner && lc(recordTeeSigner) === lc(String(matchedLog.teeSigner))), recordTeeSigner ?? "missing");
  add(checks, "AgentINFT present", Boolean(recordAgentInft), recordAgentInft ?? "missing");
  add(checks, "provider", Boolean(asString(record.provider)), asString(record.provider) ?? "missing");
  add(checks, "model", Boolean(asString(record.model)), asString(record.model) ?? "missing");
  add(checks, "reasoning", Boolean(recordReasoning && recordReasoning.trim().length > 0), recordReasoning ? `${recordReasoning.length} chars` : "missing");
  add(checks, "oracleMode", record.oracleMode === "trustless-pyth", String(record.oracleMode));
  add(checks, "pythPriceId", Boolean(recordPythPriceId && lc(recordPythPriceId) === lc(String(ev.pythPriceId))), recordPythPriceId ?? "missing");
  add(checks, "planned action", Boolean(asString(record.plannedAction) ?? asString(record.action)), String(asString(record.plannedAction) ?? asString(record.action) ?? "missing"));
  add(checks, "txHash", Boolean(recordTx && lc(recordTx) === lc(args.txHash)), recordTx ?? "missing");
  add(checks, "logIndex", recordLogIndex === matchedIndex, String(recordLogIndex ?? "missing"));
  add(checks, "executionLogCount", recordExecutionLogCount === matchedIndex + 1, String(recordExecutionLogCount ?? "missing"));
  add(checks, "amountIn", recordAmountIn === String(ev.amountIn), recordAmountIn ?? "missing");
  add(checks, "amountOut", recordAmountOut === String(ev.amountOut), recordAmountOut ?? "missing");
  add(checks, "pythPublishTime", recordPythPublishTime === Number(ev.pythPublishTime), String(recordPythPublishTime ?? "missing"));
  add(checks, "confidenceBps", recordConfidenceBps === Number(ev.pythConfBps), String(recordConfidenceBps ?? "missing"));

  if (recordAgentInft) {
    try {
      const inft = new ethers.Contract(recordAgentInft, AGENT_INFT_ABI, provider);
      const signerBound = await inft.isActiveAgentWithSigner(agent, String(matchedLog.teeSigner));
      add(checks, "TEE signer bound to AgentINFT", Boolean(signerBound), String(matchedLog.teeSigner));
    } catch (err) {
      add(checks, "TEE signer bound to AgentINFT", false, err instanceof Error ? err.message : String(err));
    }
  }

  console.log("=== Verify V2 audit record ===");
  console.log(`tx         : ${args.txHash}`);
  console.log(`vault      : ${vaultAddress}`);
  console.log(`rootHash   : ${rootHash}`);
  if (indexRecord?.storageTxHash) console.log(`storage tx : ${indexRecord.storageTxHash}`);
  console.log(`action     : ${ACTIONS[Number(matchedLog.action)] ?? String(matchedLog.action)}`);
  console.log("");

  let failures = 0;
  for (const check of checks) {
    if (!check.ok) failures += 1;
    console.log(`${check.ok ? "OK  " : "FAIL"} ${check.label}: ${check.detail}`);
  }

  if (failures > 0) {
    throw new Error(`${failures} V2 audit record check(s) failed`);
  }
  console.log("\nVerified: V2 on-chain execution and recoverable 0G reasoning record match.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
