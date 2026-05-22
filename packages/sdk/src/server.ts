// HTTP wrapper around the Sentri multi-vault agent loop.
//
// Exposes:
//   GET /healthz                       — liveness + per-vault iteration counters
//   GET /vaults                        — list of tracked vaults + their cached state
//   GET /vault/:address/state          — specific vault portfolio snapshot
//   GET /vault/:address/audit          — list of cached audit entries (most recent first)
//   GET /vault/:address/audit/:ts      — single enriched audit entry (with tolerant lookup)
//
// The agent writes the canonical record to 0G Storage. The endpoints below
// serve the local cache mirror — every entry includes its 0G Storage tx +
// root hash so any consumer can independently verify on the StorageScan
// endpoint for the active 0G network (storagescan-galileo.0g.ai or storagescan.0g.ai).

import "dotenv/config";
import express from "express";
import { ethers } from "ethers";
import {
  setupGlobalContext,
  discoverVaults,
  pushPrice,
  executeOneIterationForVault,
  refreshSignerHealth,
  log,
  type GlobalContext,
  type IterationOutcome,
} from "./agent.js";
import { describeOutcome, type Verdict } from "./outcome-verdict.js";
import {
  readVaultStateFromCache,
  readVaultAuditFromCache,
  listVaultAuditFromCache,
  findClosestVaultAudit,
  listKnownVaultsFromCache,
  readAuditEntry,
  readAuditFromKv,
  readAuditFromRecoveryRecords,
  readInferenceRecord,
  listVaultRejectionsFromCache,
  readVaultRejectionFromCache,
  readRejectionsFromKv,
} from "./storage.js";
import { AGENT, ERC20_ABI, TREASURY_VAULT_ABI } from "./constants.js";
import { updatePythOnChain } from "./market.js";
import { decodeVaultError } from "./vault-errors.js";

const ACTION_LABELS = ["Rebalance", "YieldFarm", "EmergencyDeleverage"] as const;

type ChainAuditEntry = {
  source: "chain-fallback";
  logIndex: number;
  timestamp: number;
  action: string;
  amountIn: string;
  amountOut: string;
  tvlAfter: string;
  intentHash: string;
  responseHash: string;
  teeSigner: string;
  teeAttestation: string;
  deadline: number;
  txHash?: string;
};

/**
 * Fallback: when the agent's local cache is wiped (Render restart on a
 * /tmp filesystem), reconstruct an audit list from on-chain executionLogs.
 * This loses the off-chain enrichment (model response, reasoning text,
 * signed chat payload) but preserves every verifiable field — intent
 * hash, response hash, recovered TEE signer, TEE attestation hash,
 * deadline, amounts, post-trade TVL — so the dashboard's audit tab keeps
 * working after a service restart instead of going dark.
 */
async function readAuditFromChain(
  vaultAddress: string,
  context: GlobalContext,
  limit: number,
): Promise<ChainAuditEntry[]> {
  const vault = new ethers.Contract(vaultAddress, TREASURY_VAULT_ABI, context.provider);
  const countRaw = (await vault.executionLogCount()) as bigint;
  const count = Number(countRaw);
  if (count === 0) return [];
  const start = Math.max(0, count - limit);
  const indices = Array.from({ length: count - start }, (_, i) => start + i);
  const txHashesByLogIndex = await readStrategyExecutedTxHashes(vaultAddress, context);
  const logs = await Promise.all(
    indices.map(
      (i) =>
        vault.executionLogs(i) as Promise<
          [bigint, bigint, bigint, bigint, bigint, string, string, string, string, bigint]
        >,
    ),
  );
  return logs
    .map((log, k) => ({
      source: "chain-fallback" as const,
      logIndex: indices[k],
      timestamp: Number(log[0]) * 1000,
      action: ACTION_LABELS[Number(log[1])] ?? "Unknown",
      amountIn: log[2].toString(),
      amountOut: log[3].toString(),
      tvlAfter: log[4].toString(),
      intentHash: log[5],
      responseHash: log[6],
      teeSigner: log[7],
      teeAttestation: log[8],
      deadline: Number(log[9]),
      txHash: txHashesByLogIndex.get(indices[k]),
    }))
    .reverse();
}

async function readStrategyExecutedTxHashes(
  vaultAddress: string,
  context: GlobalContext,
): Promise<Map<number, string>> {
  const hashes = new Map<number, string>();
  try {
    const iface = new ethers.Interface(TREASURY_VAULT_ABI);
    const event = iface.getEvent("StrategyExecuted");
    if (!event) return hashes;
    const latest = await context.provider.getBlockNumber();
    const defaultFromBlock = Math.max(0, latest - 1_000_000);
    const fromBlock = Number(process.env.SENTRI_AUDIT_EVENT_FROM_BLOCK ?? defaultFromBlock);
    const logs = await context.provider.getLogs({
      address: vaultAddress,
      fromBlock,
      toBlock: "latest",
      topics: [event.topicHash],
    });
    for (const raw of logs) {
      const parsed = iface.parseLog(raw);
      if (!parsed) continue;
      hashes.set(Number(parsed.args.logIndex), raw.transactionHash);
    }
  } catch {
    // Tx hash enrichment is best-effort; executionLogs remain authoritative.
  }
  return hashes;
}

async function enrichChainEntryWithInference(
  vaultAddress: string,
  entry: ChainAuditEntry,
): Promise<unknown> {
  try {
    const inference = await readInferenceRecord(vaultAddress, entry.intentHash);
    if (!inference) return entry;
    return {
      ...entry,
      source: "inference-fallback",
      amount: inference.amount,
      intent: inference.intent,
      rawResponseHash: inference.rawResponseHash,
      signedPayloadHash: inference.signedPayloadHash,
      modelResponse: inference.modelResponse,
      signedResponse: inference.signedResponse,
      teeSignature: inference.teeSignature,
      recoveredSigner: inference.recoveredSigner,
      expectedSigner: inference.expectedSigner,
      signerMatchedProvider: inference.signerMatchedProvider,
      processResponseVerified: inference.processResponseVerified,
      verified: inference.verified,
      provider: inference.provider,
      providerEndpoint: inference.providerEndpoint,
      model: inference.model,
      verifiability: inference.verifiability,
      chatID: inference.chatID,
      reasoning: inference.reasoning,
      confidence: inference.confidence,
      marketPrice: inference.marketPrice,
      marketSource: inference.marketSource,
      marketSpreadPct: inference.marketSpreadPct,
      marketSourceCount: inference.marketSourceCount,
      marketRequiredSourceCount: inference.marketRequiredSourceCount,
      marketRawSources: inference.marketRawSources,
      priceAttestationPayload: inference.priceAttestationPayload,
      storageTxHash: inference.kvTxHash,
      storageRootHash: inference.kvRootHash,
      kvIndexTxHash: inference.kvTxHash,
      kvIndexRootHash: inference.kvRootHash,
    };
  } catch {
    return entry;
  }
}

function isPriceStaleError(err: unknown): boolean {
  return decodeVaultError(err)?.name === "PriceStale" ||
    (err instanceof Error && err.message.includes("PriceStale"));
}

function pow10(decimals: bigint | number): bigint {
  return 10n ** BigInt(decimals);
}

function quoteRiskToBase(
  riskAmount: bigint,
  price: bigint,
  feedDec: bigint | number,
  baseDec: bigint | number,
  riskDec: bigint | number,
): bigint {
  return (riskAmount * price * pow10(baseDec)) / (pow10(feedDec) * pow10(riskDec));
}

async function readTvlForDisplay(
  vault: ethers.Contract,
  context: GlobalContext,
  vaultBalance: bigint,
  riskBalance: bigint,
): Promise<{ totalValue: bigint; source: "totalValue" | "latest-price-fallback" }> {
  try {
    return { totalValue: (await vault.totalValue()) as bigint, source: "totalValue" };
  } catch (err) {
    if (!isPriceStaleError(err)) throw err;
    const [baseAddr, riskAddr, round, feedDec] = await Promise.all([
      vault.base() as Promise<string>,
      vault.risk() as Promise<string>,
      context.priceFeed.latestRoundData() as Promise<[bigint, bigint, bigint, bigint, bigint]>,
      context.priceFeed.decimals() as Promise<bigint | number>,
    ]);
    const answer = BigInt(round[1]);
    if (answer <= 0n) throw err;
    const baseToken = new ethers.Contract(baseAddr, ERC20_ABI, context.provider);
    const riskToken = new ethers.Contract(riskAddr, ERC20_ABI, context.provider);
    const [baseDec, riskDec] = await Promise.all([
      baseToken.decimals() as Promise<bigint | number>,
      riskToken.decimals() as Promise<bigint | number>,
    ]);
    return {
      totalValue: vaultBalance + quoteRiskToBase(riskBalance, answer, feedDec, baseDec, riskDec),
      source: "latest-price-fallback",
    };
  }
}

async function readVaultStateFromChain(
  vaultAddress: string,
  context: GlobalContext,
): Promise<unknown> {
  const vault = new ethers.Contract(vaultAddress, TREASURY_VAULT_ABI, context.provider);
  const [vaultBalance, riskBalance, highWaterMark, executionLogCount] =
    await Promise.all([
      vault.vaultBalance() as Promise<bigint>,
      vault.riskBalance() as Promise<bigint>,
      vault.highWaterMark() as Promise<bigint>,
      vault.executionLogCount() as Promise<bigint>,
    ]);
  const { totalValue, source: totalValueSource } = await readTvlForDisplay(
    vault,
    context,
    vaultBalance,
    riskBalance,
  );
  return {
    source: "chain-fallback" as const,
    totalValueSource,
    vaultBalance: vaultBalance.toString(),
    riskBalance: riskBalance.toString(),
    totalValue: totalValue.toString(),
    highWaterMark: highWaterMark.toString(),
    totalExecutions: Number(executionLogCount),
  };
}

const PORT = Number(process.env.PORT ?? 8080);
const CYCLE_INTERVAL_MS = Number(process.env.AGENT_INTERVAL_MS ?? AGENT.cycleIntervalMs);
const INFERENCE_FUNDING_BACKOFF_MS = Number(process.env.INFERENCE_FUNDING_BACKOFF_MS ?? 15 * 60_000);

// Build provenance — surfaced in /healthz so an operator can confirm the live
// runtime matches the intended commit instead of debugging a stale build.
// Render injects RENDER_GIT_COMMIT / RENDER_GIT_BRANCH automatically; the
// SENTRI_GIT_SHA fallback covers non-Render hosts.
const BUILD_INFO = {
  gitSha: process.env.RENDER_GIT_COMMIT ?? process.env.SENTRI_GIT_SHA ?? null,
  gitBranch: process.env.RENDER_GIT_BRANCH ?? null,
} as const;

interface VaultState {
  totalIterations: number;
  totalErrors: number;
  lastIterationAt: number | null;
  lastOutcome: IterationOutcome | null;
  inferenceFundingBackoffUntil: number | null;
}

interface ServerState {
  startedAt: number;
  lastCycleAt: number | null;
  lastCycleVaultCount: number;
  totalCycles: number;
  totalCycleErrors: number;
  agentStatus: "initializing" | "ready" | "error";
  agentSetupError: string | null;
  trackedVaults: Map<string, VaultState>;
}

const state: ServerState = {
  startedAt: Date.now(),
  lastCycleAt: null,
  lastCycleVaultCount: 0,
  totalCycles: 0,
  totalCycleErrors: 0,
  agentStatus: "initializing",
  agentSetupError: null,
  trackedVaults: new Map(),
};

let ctx: GlobalContext | null = null;
let cycleInProgress = false;

/**
 * Augment a VaultState for API responses with a human-readable verdict derived
 * from its last outcome — so consumers (dashboard) can show "Target reached" or
 * "Defensive hold" instead of a bare "skipped".
 */
function runtimeWithVerdict(
  s: VaultState | null,
): (VaultState & { lastVerdict: Verdict | null }) | null {
  if (!s) return null;
  return { ...s, lastVerdict: s.lastOutcome ? describeOutcome(s.lastOutcome) : null };
}

function getOrInitVault(address: string): VaultState {
  const key = address.toLowerCase();
  let s = state.trackedVaults.get(key);
  if (!s) {
    s = {
      totalIterations: 0,
      totalErrors: 0,
      lastIterationAt: null,
      lastOutcome: null,
      inferenceFundingBackoffUntil: null,
    };
    state.trackedVaults.set(key, s);
  }
  return s;
}

function isInferenceFundingError(reason: string): boolean {
  return reason.includes("InsufficientAvailableBalance")
    || reason.includes("insufficient balance")
    || reason.includes("Please add more funds")
    || reason.includes("transfer-fund --provider");
}

async function runCycle(): Promise<void> {
  if (!ctx) {
    log("[server] runCycle called before agent ready — skipping.");
    return;
  }
  if (cycleInProgress) {
    log("[server] previous cycle still running — skipping tick.");
    return;
  }
  cycleInProgress = true;
  state.totalCycles++;

  // Hard signer-health gate (P2). If the selected 0G provider's TEE signer is
  // not bound to the agent's active AgentINFT, executeStrategy can only revert
  // with InvalidTEESignature — so skip the whole cycle: no Pyth pull, no price
  // push, no inference, no executeStrategy. Vault creation and deposits are
  // unaffected; funds are safe. Re-evaluated every cycle so the runner resumes
  // automatically once the binding is reconciled on-chain.
  const signerHealthy = await refreshSignerHealth(ctx);
  if (!signerHealthy) {
    log(
      "[server] BLOCKED_SIGNER_HEALTH — auto-execution disabled (TEE signer mismatch). " +
        `expected=${ctx.signerHealth.expectedSigner || "(unresolved)"} ` +
        `provider=${ctx.signerHealth.providerSigner}. ` +
        "Funds are safe; see docs/operator-signer-mismatch.md.",
    );
    state.lastCycleAt = Date.now();
    cycleInProgress = false;
    return;
  }

  // Pyth on-chain pull (if PYTH_ONCHAIN_ADDRESS is configured): submit the
  // latest 0G/USD VAA on-chain so any reader can call getPriceNoOlderThan
  // trustlessly without keeper dependency. Non-blocking — failure does not
  // stop the cycle. Pattern: https://docs.pyth.network/price-feeds/use-real-time-data/evm
  void updatePythOnChain(ctx.wallet).catch((e: unknown) => {
    log(`[server] Pyth on-chain pull skipped: ${e instanceof Error ? e.message : e}`);
  });

  try {
    const market = await pushPrice(ctx);
    const vaults = await discoverVaults(ctx);
    state.lastCycleVaultCount = vaults.length;
    log(`[server] cycle ${state.totalCycles}: ${vaults.length} vault(s) tracked`);

    for (const vaultAddr of vaults) {
      const v = getOrInitVault(vaultAddr);
      v.totalIterations++;
      if (v.inferenceFundingBackoffUntil && Date.now() < v.inferenceFundingBackoffUntil) {
        const seconds = Math.ceil((v.inferenceFundingBackoffUntil - Date.now()) / 1000);
        v.lastOutcome = {
          status: "skipped",
          reason: `inference funding backoff (${seconds}s remaining)`,
        };
        v.lastIterationAt = Date.now();
        log(`  ${vaultAddr.slice(0, 10)}... → skipped (${v.lastOutcome.reason})`);
        continue;
      }
      try {
        const outcome = await executeOneIterationForVault(ctx, vaultAddr, market);
        v.inferenceFundingBackoffUntil = null;
        v.lastOutcome = outcome;
        log(`  ${vaultAddr.slice(0, 10)}... → ${outcome.status} — ${describeOutcome(outcome).text}`);
      } catch (err) {
        v.totalErrors++;
        const reason = err instanceof Error ? err.message : String(err);
        if (isInferenceFundingError(reason)) {
          v.inferenceFundingBackoffUntil = Date.now() + INFERENCE_FUNDING_BACKOFF_MS;
        }
        v.lastOutcome = { status: "error", reason };
        log(`  ${vaultAddr.slice(0, 10)}... → ERROR: ${reason}`);
      } finally {
        v.lastIterationAt = Date.now();
      }
    }
  } catch (err) {
    state.totalCycleErrors++;
    log(`[server] cycle error: ${err instanceof Error ? err.message : err}`);
  } finally {
    state.lastCycleAt = Date.now();
    cycleInProgress = false;
  }
}

// ── App ──────────────────────────────────────────────────────────────────

const app = express();

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/healthz", (_req, res) => {
  const vaults: Record<string, ReturnType<typeof runtimeWithVerdict>> = {};
  for (const [addr, s] of state.trackedVaults.entries()) {
    vaults[addr] = runtimeWithVerdict(s);
  }
  res.json({
    ok: state.agentStatus !== "error",
    agent: state.agentStatus,
    setupError: state.agentSetupError,
    build: BUILD_INFO,
    cycles: {
      total: state.totalCycles,
      errors: state.totalCycleErrors,
      lastAt: state.lastCycleAt,
      lastVaultCount: state.lastCycleVaultCount,
      inProgress: cycleInProgress,
    },
    config: {
      intervalSec: CYCLE_INTERVAL_MS / 1000,
      walletAddress: ctx?.walletAddress ?? null,
      provider: ctx?.providerInfo?.address ?? null,
      model: ctx?.providerInfo?.model ?? null,
      factoryAddress: ctx?.factory.target ?? null,
    },
    // Signer-health gate: when ok=false, auto-execution is disabled (TEE signer
    // not bound to the active AgentINFT). Vault creation and deposits are
    // unaffected. See docs/operator-signer-mismatch.md.
    autoExecute: ctx ? ctx.signerHealth.ok : false,
    signerHealth: ctx
      ? {
          ok: ctx.signerHealth.ok,
          expectedSigner: ctx.signerHealth.expectedSigner || null,
          providerSigner: ctx.signerHealth.providerSigner,
          checkedAt: ctx.signerHealth.checkedAt || null,
        }
      : null,
    uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
    trackedVaultCount: state.trackedVaults.size,
    vaults,
  });
});

app.get("/vaults", (_req, res) => {
  // Aggregate live runtime state + cached portfolio state for every known vault.
  const known = new Set<string>([
    ...state.trackedVaults.keys(),
    ...listKnownVaultsFromCache().map((a) => a.toLowerCase()),
  ]);
  const list = Array.from(known).map((addr) => {
    const runtime = state.trackedVaults.get(addr) ?? null;
    const cache = readVaultStateFromCache(addr);
    return {
      address: addr,
      runtime: runtimeWithVerdict(runtime),
      portfolio: cache,
    };
  });
  res.json({ count: list.length, vaults: list });
});

app.get("/vault/:address/state", async (req, res) => {
  const addr = req.params.address;
  const runtime = state.trackedVaults.get(addr.toLowerCase()) ?? null;
  const cache = readVaultStateFromCache(addr);
  // If the agent has runtime metadata but no portfolio cache (e.g. after a
  // Render restart that wiped /tmp but tracked vaults populated on the next
  // cycle), still try a chain fallback so the response carries portfolio
  // data instead of `null`.
  let portfolio: unknown = cache;
  if (!portfolio && ctx) {
    try {
      portfolio = await readVaultStateFromChain(addr, ctx);
    } catch {
      portfolio = null;
    }
  }
  if (!portfolio && !runtime) {
    res.status(404).json({ error: "Vault not tracked yet (no cycle has run on it)." });
    return;
  }
  res.json({
    address: addr,
    runtime: runtimeWithVerdict(runtime),
    portfolio,
    source: cache ? "cache" : portfolio ? "chain-fallback" : "runtime-only",
  });
});

app.get("/vault/:address/audit", async (req, res) => {
  const addr = req.params.address;
  const timestamps = listVaultAuditFromCache(addr, 50);
  const cached = timestamps
    .map((ts) => readVaultAuditFromCache(addr, ts))
    .filter((e): e is NonNullable<typeof e> => e !== null);
  if (cached.length > 0) {
    res.json({ address: addr, count: cached.length, entries: cached, source: "cache" });
    return;
  }
  // Cache empty (likely after a Render restart). Try 0G Storage KV manifest first.
  try {
    const kvEntries = await readAuditFromKv(addr, 50);
    if (kvEntries.length > 0) {
      res.json({ address: addr, count: kvEntries.length, entries: kvEntries, source: "kv-fallback" });
      return;
    }
  } catch {
    // KV unreachable — continue to chain fallback below.
  }
  try {
    const recoveredEntries = await readAuditFromRecoveryRecords(addr, 50);
    if (recoveredEntries.length > 0) {
      res.json({ address: addr, count: recoveredEntries.length, entries: recoveredEntries, source: "cache" });
      return;
    }
  } catch {
    // Recovery unavailable — continue to chain fallback below.
  }
  if (!ctx) {
    res.json({ address: addr, count: 0, entries: [], source: "no-context" });
    return;
  }
  try {
    const entries = await readAuditFromChain(addr, ctx, 50);
    res.json({
      address: addr,
      count: entries.length,
      entries,
      source: "chain-fallback",
      note:
        "Local cache empty (typical after a service restart). Showing on-chain executionLogs " +
        "without off-chain enrichment (model response, reasoning, signed chat payload). " +
        "Verify each entry's intentHash, responseHash, teeSigner and teeAttestation on chainscan.",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/vault/:address/audit/:timestamp", async (req, res) => {
  const addr = req.params.address;
  const ts = req.params.timestamp;
  let entry = readVaultAuditFromCache(addr, ts);
  if (!entry) {
    const closest = findClosestVaultAudit(addr, Number(ts));
    if (closest) entry = readVaultAuditFromCache(addr, closest);
  }
  if (entry) {
    res.json(entry);
    return;
  }
  // Cache miss. Try KV manifest fallback (survives Render restarts with full enrichment).
  try {
    const kvEntries = await readAuditFromKv(addr, 50);
    if (kvEntries.length > 0) {
      const requested = Number(ts);
      const kvMatch =
        kvEntries.find((e) => String(e.timestamp) === ts) ??
        kvEntries.reduce<typeof kvEntries[number] | null>(
          (closest, e) =>
            closest === null ||
            Math.abs(e.timestamp - requested) < Math.abs(closest.timestamp - requested)
              ? e
              : closest,
          null,
        );
      if (kvMatch) {
        res.json({ ...kvMatch, source: "kv-fallback" });
        return;
      }
    }
  } catch {
    // KV unreachable — continue to chain fallback below.
  }
  try {
    const recoveredEntries = await readAuditFromRecoveryRecords(addr, 50);
    if (recoveredEntries.length > 0) {
      const requested = Number(ts);
      const recoveredMatch =
        recoveredEntries.find((e) => String(e.timestamp) === ts) ??
        recoveredEntries.reduce<typeof recoveredEntries[number] | null>(
          (closest, e) =>
            closest === null ||
            Math.abs(e.timestamp - requested) < Math.abs(closest.timestamp - requested)
              ? e
              : closest,
          null,
        );
      if (recoveredMatch) {
        res.json({ ...recoveredMatch, source: "cache" });
        return;
      }
    }
  } catch {
    // Recovery unavailable — continue to chain fallback below.
  }
  // KV miss. Fall back to on-chain log lookup so the detail view still has something to show.
  if (!ctx) {
    res.status(404).json({ error: "No enriched audit entry cached for this timestamp." });
    return;
  }
  try {
    const onchain = await readAuditFromChain(addr, ctx, 50);
    const requested = Number(ts);
    const match =
      onchain.find((e) => e.timestamp === requested) ??
      onchain.reduce<typeof onchain[number] | null>(
        (closest, e) =>
          closest === null ||
          Math.abs(e.timestamp - requested) < Math.abs(closest.timestamp - requested)
            ? e
            : closest,
        null,
      );
    if (!match) {
      res.status(404).json({ error: "No on-chain executionLog found for this vault either." });
      return;
    }
    if (match.txHash) {
      try {
        const directKvEntry = await readAuditEntry(addr, match);
        if (directKvEntry) {
          res.json({ ...directKvEntry, source: "kv-direct-fallback" });
          return;
        }
      } catch {
        // Direct deterministic KV lookup is best-effort; continue to inference fallback.
      }
    }
    res.json(await enrichChainEntryWithInference(addr, { ...match, source: "chain-fallback" }));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/vault/:address/rejections", async (req, res) => {
  const addr = req.params.address;
  const timestamps = listVaultRejectionsFromCache(addr, 50);
  let entries = timestamps
    .map((ts) => readVaultRejectionFromCache(addr, ts))
    .filter((e): e is NonNullable<typeof e> => e !== null);
  // Fallback to KV manifest if cache is empty (e.g. after restart).
  if (entries.length === 0) {
    entries = await readRejectionsFromKv(addr);
  }
  res.json({ address: addr, count: entries.length, entries });
});

app.get("/", (_req, res) => res.redirect("/healthz"));

app.listen(PORT, () => {
  log(`[server] listening on :${PORT}`);
  log(`[server] cycle interval = ${CYCLE_INTERVAL_MS / 1000}s`);
  log("[server] initializing agent (Sealed Inference broker + Storage)...");

  setupGlobalContext()
    .then((c) => {
      ctx = c;
      state.agentStatus = "ready";
      log("[server] agent ready. Scheduling cycles.");
      setInterval(runCycle, CYCLE_INTERVAL_MS);
      void runCycle();
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      state.agentStatus = "error";
      state.agentSetupError = msg;
      log(`[server] FATAL setup error: ${msg}`);
    });
});

process.on("SIGTERM", () => {
  log("[server] SIGTERM received, exiting.");
  process.exit(0);
});
process.on("SIGINT", () => {
  log("[server] SIGINT received, exiting.");
  process.exit(0);
});
