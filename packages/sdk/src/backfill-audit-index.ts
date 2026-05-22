import fs from "node:fs";
import "dotenv/config";
import { initAuditIndex, writeAuditIndexRecord, type AuditIndexRecord } from "./audit-index.js";

interface Candidate {
  vaultAddress?: string;
  vault?: string;
  txHash?: string;
  logIndex?: number;
  intentHash?: string;
  responseHash?: string;
  rootHash?: string;
  storageTxHash?: string;
  action?: string;
  timestamp?: number;
  createdAt?: number;
  updatedAt?: number;
}

function usage(): never {
  throw new Error(
    "Usage: pnpm --filter @steward/sdk backfill-audit-index --logs <file> (--dry-run | --apply)",
  );
}

function argValue(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? (process.argv[idx + 1] ?? null) : null;
}

function loadCandidates(file: string): Candidate[] {
  const raw = fs.readFileSync(file, "utf-8");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as Candidate[];
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown[] }).entries)) {
      return (parsed as { entries: Candidate[] }).entries;
    }
  } catch {
    // Fall through to JSONL parsing.
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Candidate];
      } catch {
        return [];
      }
    });
}

function normalize(candidate: Candidate): AuditIndexRecord | null {
  const vaultAddress = candidate.vaultAddress ?? candidate.vault;
  if (!vaultAddress || !candidate.intentHash || !candidate.rootHash) return null;
  if (!candidate.txHash && candidate.logIndex == null && !candidate.responseHash) return null;
  const createdAt = candidate.createdAt ?? candidate.timestamp ?? Date.now();
  return {
    vaultAddress,
    txHash: candidate.txHash,
    logIndex: candidate.logIndex,
    intentHash: candidate.intentHash,
    responseHash: candidate.responseHash,
    rootHash: candidate.rootHash,
    storageTxHash: candidate.storageTxHash,
    action: candidate.action,
    createdAt,
    updatedAt: candidate.updatedAt ?? createdAt,
  };
}

async function main(): Promise<void> {
  const logs = argValue("--logs");
  const dryRun = process.argv.includes("--dry-run");
  const apply = process.argv.includes("--apply");
  if (!logs || dryRun === apply) usage();

  const stats = initAuditIndex();
  if (apply && !stats.writable) {
    throw new Error(`audit index not writable: ${stats.lastError ?? "unknown error"}`);
  }

  const records = loadCandidates(logs).map(normalize).filter((r): r is AuditIndexRecord => r !== null);
  console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "apply", validRecords: records.length }, null, 2));
  if (!apply) return;
  for (const record of records) writeAuditIndexRecord(record);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
