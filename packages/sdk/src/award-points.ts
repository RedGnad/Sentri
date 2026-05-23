import "dotenv/config";
import { pathToFileURL } from "node:url";
import {
  awardPoints,
  assertPointsLedgerWritable,
  buildManualUniqueKey,
  createPointsEntry,
  initPointsLedger,
  type PointType,
  type PointsEntry,
} from "./points.js";

interface AwardArgs {
  wallet: string;
  points: number;
  type: PointType;
  reason: string;
  vault?: string;
  tx?: string;
  logIndex?: number;
  uniqueKey?: string;
  apply: boolean;
}

interface CliIo {
  log(message: string): void;
  error(message: string): void;
}

const TYPES = new Set<PointType>([
  "active_vault_hour",
  "safe_blocked_action",
  "useful_feedback",
  "shipped_bug_report",
  "exceptional_bonus",
]);

function usage(): never {
  throw new Error(
    "Usage: pnpm --filter @steward/sdk award-points --wallet 0x... --points 20000 " +
      "--type exceptional_bonus --reason \"Early external vault bonus (lab rat)\" [--apply]",
  );
}

function argValue(argv: string[], name: string): string | null {
  const idx = argv.indexOf(name);
  return idx >= 0 ? (argv[idx + 1] ?? null) : null;
}

function positiveNumber(value: string | null, name: string): number {
  if (!value) usage();
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function pointType(value: string | null): PointType {
  if (!value || !TYPES.has(value as PointType)) {
    throw new Error(`Invalid --type. Expected one of: ${[...TYPES].join(", ")}`);
  }
  return value as PointType;
}

function optionalNumber(value: string | null, name: string): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

export function parseAwardArgs(argv: string[]): AwardArgs {
  const wallet = argValue(argv, "--wallet");
  const reason = argValue(argv, "--reason");
  if (!wallet || !reason) usage();
  const points = positiveNumber(argValue(argv, "--points"), "--points");
  const type = pointType(argValue(argv, "--type"));
  return {
    wallet,
    points,
    type,
    reason,
    vault: argValue(argv, "--vault") ?? undefined,
    tx: argValue(argv, "--tx") ?? undefined,
    logIndex: optionalNumber(argValue(argv, "--log-index"), "--log-index"),
    uniqueKey: argValue(argv, "--unique-key") ?? undefined,
    apply: argv.includes("--apply"),
  };
}

export function buildAwardEntry(args: AwardArgs, now = Date.now()): PointsEntry {
  const uniqueKey = args.uniqueKey ?? buildManualUniqueKey(args.type, args.wallet, args.points, args.reason);
  return createPointsEntry({
    uniqueKey,
    wallet: args.wallet,
    vaultAddress: args.vault,
    type: args.type,
    points: args.points,
    reason: args.reason,
    txHash: args.tx,
    logIndex: args.logIndex,
    createdAt: now,
  });
}

export async function runAwardPointsCli(
  argv = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = console,
): Promise<number> {
  try {
    const args = parseAwardArgs(argv);
    const entry = buildAwardEntry(args);
    io.log(JSON.stringify({ mode: args.apply ? "apply" : "dry-run", entry }, null, 2));
    if (!args.apply) return 0;
    initPointsLedger(env.POINTS_LEDGER_PATH);
    assertPointsLedgerWritable();
    const result = awardPoints(entry);
    io.log(JSON.stringify(result, null, 2));
    return result.awarded || result.reason === "duplicate uniqueKey" ? 0 : 1;
  } catch (err) {
    io.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runAwardPointsCli().then((code) => {
    process.exitCode = code;
  });
}
