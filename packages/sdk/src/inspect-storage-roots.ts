#!/usr/bin/env tsx
/**
 * Read-only 0G Storage forensic helper.
 *
 * Downloads one or more root hashes as plain JSON blobs, summarizes their
 * schema and audit-identifying fields, then checks whether they match a target
 * vault and/or transaction. It does not write to the audit index, contracts, or
 * runtime cache.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "dotenv/config";
import { Indexer } from "@0gfoundation/0g-ts-sdk";

const MAINNET_INDEXER = "https://indexer-storage-turbo.0g.ai";
const GALILEO_INDEXER = "https://indexer-storage-testnet-turbo.0g.ai";
const DEFAULT_V2_VAULT = "0x86cE22c597D0C4EC309ba166360686C39A3f40ed";
const DEFAULT_V2_TX = "0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa";
const ROOT_RE = /^0x[a-fA-F0-9]{64}$/;
const DEFAULT_TIMEOUT_MS = Number(process.env.STORAGE_BLOB_DOWNLOAD_TIMEOUT_MS ?? "15000");

const INTERESTING_FIELDS = [
  "schema",
  "type",
  "vault",
  "vaultAddress",
  "txHash",
  "intentHash",
  "responseHash",
  "agent",
  "agentAddress",
  "agentNFT",
  "agentINFT",
  "AgentINFT",
  "teeSigner",
  "provider",
  "model",
  "pythPriceId",
  "pythPublishTime",
  "pythConfBps",
  "confidence",
  "confidenceBps",
  "storageRoot",
  "storageRootHash",
  "canonicalRootHash",
] as const;

type InterestingField = (typeof INTERESTING_FIELDS)[number];

interface Args {
  roots: string[];
  rootsFiles: string[];
  vault?: string;
  tx?: string;
  network: "mainnet" | "galileo";
  indexerUrl: string;
  timeoutMs: number;
}

interface FieldHit {
  path: string;
  value: string | number | boolean | null;
}

interface InspectResult {
  rootHash: string;
  ok: boolean;
  download: {
    indexerUrl: string;
    error?: string;
  };
  record?: {
    topLevel: {
      schema?: string;
      type?: string;
      keys: string[];
    };
    fields: Partial<Record<InterestingField, FieldHit[]>>;
    hasSentriInferenceV1: boolean;
    reasoning: {
      present: boolean;
      paths: Array<{ path: string; length: number }>;
    };
    auditIndexCandidate: {
      usable: boolean;
      reason: string;
    };
  };
  match: {
    targetVault?: string;
    targetTx?: string;
    vault: boolean;
    tx: boolean;
    both: boolean;
  };
}

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  pnpm --filter @steward/sdk inspect:storage-roots -- [options] <rootHash...>",
      "",
      "Options:",
      "  --vault <address>       Target vault to match. Defaults to the V2 canary vault.",
      "  --tx <hash>             Target transaction to match. Defaults to the V2 canonical tx.",
      "  --roots <list>          Comma/space-separated roots, or JSON array/records with rootHash.",
      "  --roots-file <path>     JSON, JSONL, or plain text roots file. Repeatable.",
      "  --network <name>        mainnet or galileo. Defaults to SENTRI_NETWORK, then mainnet.",
      "  --indexer <url>         Override 0G Storage indexer URL.",
      "  --timeout-ms <ms>       Download timeout per root.",
      "",
      "Env roots also supported:",
      "  SENTRI_AUDIT_RECOVERY_RECORDS, AUDIT_RECOVERY_ROOTS, STORAGE_ROOTS",
    ].join("\n"),
  );
}

function normalizeHash(value: string): string {
  return value.toLowerCase();
}

function isRootHash(value: string): boolean {
  return ROOT_RE.test(value);
}

function primitiveSummary(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "string") return String(value);
  if (value.length <= 180) return value;
  return `${value.slice(0, 80)}...${value.slice(-24)} (${value.length} chars)`;
}

function parseRootValues(value: unknown): string[] {
  if (typeof value === "string") {
    if (isRootHash(value.trim())) return [value.trim()];
    return value
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter(isRootHash);
  }
  if (Array.isArray(value)) return value.flatMap(parseRootValues);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ownRoot = typeof record.rootHash === "string" && isRootHash(record.rootHash)
      ? [record.rootHash]
      : [];
    return [
      ...ownRoot,
      ...Object.values(record)
        .filter((nested) => nested && typeof nested === "object")
        .flatMap(parseRootValues),
    ];
  }
  return [];
}

function parseRootList(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    return parseRootValues(JSON.parse(trimmed) as unknown);
  } catch {
    return parseRootValues(trimmed);
  }
}

function parseRootFile(file: string): string[] {
  const raw = fs.readFileSync(file, "utf-8");
  const parsed = parseRootList(raw);
  if (parsed.length > 0) return parsed;
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return parseRootValues(JSON.parse(line) as unknown);
      } catch {
        return parseRootValues(line);
      }
    });
}

function rootsFromEnv(): string[] {
  return [
    process.env.SENTRI_AUDIT_RECOVERY_RECORDS,
    process.env.AUDIT_RECOVERY_ROOTS,
    process.env.STORAGE_ROOTS,
  ].flatMap((raw) => (raw ? parseRootList(raw) : []));
}

function uniqueRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const root of roots) {
    const key = normalizeHash(root);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
  }
  return out;
}

function parseArgs(): Args {
  const roots: string[] = [];
  const rootsFiles: string[] = [];
  const envNetwork = process.env.SENTRI_NETWORK ?? process.env.NEXT_PUBLIC_SENTRI_NETWORK ?? "mainnet";
  let network: "mainnet" | "galileo" = envNetwork === "galileo" ? "galileo" : "mainnet";
  let vault = DEFAULT_V2_VAULT;
  let tx = DEFAULT_V2_TX;
  let indexerUrl = process.env.STORAGE_INDEXER_URL ?? "";
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage();
    if (arg === "--vault") {
      vault = argv[++i] ?? usage();
    } else if (arg === "--tx") {
      tx = argv[++i] ?? usage();
    } else if (arg === "--roots") {
      roots.push(...parseRootList(argv[++i] ?? usage()));
    } else if (arg === "--roots-file") {
      rootsFiles.push(argv[++i] ?? usage());
    } else if (arg === "--network") {
      const value = argv[++i] ?? usage();
      if (value !== "mainnet" && value !== "galileo") usage();
      network = value;
    } else if (arg === "--indexer") {
      indexerUrl = argv[++i] ?? usage();
    } else if (arg === "--timeout-ms") {
      timeoutMs = Number(argv[++i] ?? usage());
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) usage();
    } else if (arg.startsWith("--")) {
      usage();
    } else {
      roots.push(...parseRootList(arg));
    }
  }

  indexerUrl ||= network === "mainnet" ? MAINNET_INDEXER : GALILEO_INDEXER;
  const fileRoots = rootsFiles.flatMap(parseRootFile);
  const allRoots = uniqueRoots([...roots, ...fileRoots, ...rootsFromEnv()]);
  if (allRoots.length === 0) usage();
  return { roots: allRoots, rootsFiles, vault, tx, network, indexerUrl, timeoutMs };
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).slice(0, 40);
}

function topString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : undefined;
}

function pushHit(
  fields: Partial<Record<InterestingField, FieldHit[]>>,
  field: InterestingField,
  hit: FieldHit,
): void {
  const hits = fields[field] ?? [];
  if (hits.length < 12) hits.push(hit);
  fields[field] = hits;
}

function pathFor(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent ? `${parent}.${key}` : key;
}

function inspectJson(value: unknown): InspectResult["record"] {
  const fields: Partial<Record<InterestingField, FieldHit[]>> = {};
  const reasoningPaths: Array<{ path: string; length: number }> = [];
  let hasSentriInferenceV1 = false;

  function walk(node: unknown, currentPath: string): void {
    if (typeof node === "string" && node === "sentri.inference.v1") {
      hasSentriInferenceV1 = true;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, pathFor(currentPath, index)));
      return;
    }

    const object = node as Record<string, unknown>;
    for (const [key, nested] of Object.entries(object)) {
      const nestedPath = pathFor(currentPath, key);
      if ((INTERESTING_FIELDS as readonly string[]).includes(key)) {
        pushHit(fields, key as InterestingField, {
          path: nestedPath,
          value: primitiveSummary(nested),
        });
      }
      if (key === "reasoning" && typeof nested === "string" && nested.trim().length > 0) {
        reasoningPaths.push({ path: nestedPath, length: nested.length });
      }
      walk(nested, nestedPath);
    }
  }

  walk(value, "");

  const vaultHits = [...(fields.vault ?? []), ...(fields.vaultAddress ?? [])];
  const intentHits = fields.intentHash ?? [];
  const responseHits = fields.responseHash ?? [];
  const hasReasoning = reasoningPaths.length > 0;
  const usable = vaultHits.length > 0 && intentHits.length > 0 && responseHits.length > 0 && hasReasoning;
  const missing = [
    vaultHits.length === 0 ? "vault" : null,
    intentHits.length === 0 ? "intentHash" : null,
    responseHits.length === 0 ? "responseHash" : null,
    !hasReasoning ? "reasoning" : null,
  ].filter((part): part is string => Boolean(part));

  return {
    topLevel: {
      schema: topString(value, "schema"),
      type: topString(value, "type"),
      keys: objectKeys(value),
    },
    fields,
    hasSentriInferenceV1,
    reasoning: {
      present: hasReasoning,
      paths: reasoningPaths.slice(0, 8),
    },
    auditIndexCandidate: {
      usable,
      reason: usable ? "vault, intentHash, responseHash and reasoning are present" : `missing ${missing.join(", ")}`,
    },
  };
}

function fieldStringValues(
  fields: Partial<Record<InterestingField, FieldHit[]>>,
  names: InterestingField[],
): string[] {
  return names.flatMap((name) =>
    (fields[name] ?? [])
      .map((hit) => hit.value)
      .filter((value): value is string => typeof value === "string"),
  );
}

function computeMatch(
  record: InspectResult["record"] | undefined,
  vault: string | undefined,
  tx: string | undefined,
): InspectResult["match"] {
  const fields = record?.fields ?? {};
  const vaultValues = fieldStringValues(fields, ["vault", "vaultAddress"]);
  const txValues = fieldStringValues(fields, ["txHash"]);
  const vaultMatched = Boolean(vault && vaultValues.some((value) => value.toLowerCase() === vault.toLowerCase()));
  const txMatched = Boolean(tx && txValues.some((value) => value.toLowerCase() === tx.toLowerCase()));
  return {
    targetVault: vault,
    targetTx: tx,
    vault: vaultMatched,
    tx: txMatched,
    both: Boolean(vault && tx && vaultMatched && txMatched),
  };
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

async function downloadJson(indexer: Indexer, rootHash: string, timeoutMs: number): Promise<unknown> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentri-storage-root-"));
  const tempFile = path.join(tempDir, `${rootHash}.json`);
  try {
    const err = await withTimeout(
      indexer.download(rootHash, tempFile, false),
      timeoutMs,
      `0G Storage download ${rootHash}`,
    );
    if (err !== null) throw new Error(String(err));
    return JSON.parse(fs.readFileSync(tempFile, "utf-8")) as unknown;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function inspectRoot(indexer: Indexer, args: Args, rootHash: string): Promise<InspectResult> {
  try {
    const blob = await downloadJson(indexer, rootHash, args.timeoutMs);
    const record = inspectJson(blob);
    return {
      rootHash,
      ok: true,
      download: { indexerUrl: args.indexerUrl },
      record,
      match: computeMatch(record, args.vault, args.tx),
    };
  } catch (err) {
    return {
      rootHash,
      ok: false,
      download: {
        indexerUrl: args.indexerUrl,
        error: err instanceof Error ? err.message : String(err),
      },
      match: computeMatch(undefined, args.vault, args.tx),
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const indexer = new Indexer(args.indexerUrl);
  const results: InspectResult[] = [];
  for (const root of args.roots) {
    results.push(await inspectRoot(indexer, args, root));
  }

  const matched = results.filter((result) => result.match.both);
  const summary = {
    mode: "read-only",
    network: args.network,
    indexerUrl: args.indexerUrl,
    inspected: results.length,
    downloaded: results.filter((result) => result.ok).length,
    matchedVault: results.filter((result) => result.match.vault).length,
    matchedTx: results.filter((result) => result.match.tx).length,
    matchedBoth: matched.length,
    canBackfillDirectly: matched.some((result) => Boolean(result.record?.auditIndexCandidate.usable)),
    note: matched.length > 0
      ? "At least one root matches the target vault and tx. Review auditIndexCandidate before any separate backfill."
      : "No inspected root matched both the target V2 vault and canonical tx.",
  };

  console.log(JSON.stringify({ summary, results }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
