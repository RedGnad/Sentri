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
// root hash so any consumer can independently verify on
// https://storagescan-galileo.0g.ai.

import "dotenv/config";
import express from "express";
import { ethers } from "ethers";
import {
  setupGlobalContext,
  discoverVaults,
  pushPrice,
  executeOneIterationForVault,
  log,
  type GlobalContext,
  type IterationOutcome,
} from "./agent.js";
import {
  readVaultStateFromCache,
  readVaultAuditFromCache,
  listVaultAuditFromCache,
  findClosestVaultAudit,
  listKnownVaultsFromCache,
} from "./storage.js";
import { AGENT, TREASURY_VAULT_ABI } from "./constants.js";

const ACTION_LABELS = ["Rebalance", "YieldFarm", "EmergencyDeleverage"] as const;

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
): Promise<unknown[]> {
  const vault = new ethers.Contract(vaultAddress, TREASURY_VAULT_ABI, context.provider);
  const countRaw = (await vault.executionLogCount()) as bigint;
  const count = Number(countRaw);
  if (count === 0) return [];
  const start = Math.max(0, count - limit);
  const indices = Array.from({ length: count - start }, (_, i) => start + i);
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
    }))
    .reverse();
}

async function readVaultStateFromChain(
  vaultAddress: string,
  context: GlobalContext,
): Promise<unknown> {
  const vault = new ethers.Contract(vaultAddress, TREASURY_VAULT_ABI, context.provider);
  const [vaultBalance, riskBalance, totalValue, highWaterMark, executionLogCount] =
    await Promise.all([
      vault.vaultBalance() as Promise<bigint>,
      vault.riskBalance() as Promise<bigint>,
      vault.totalValue() as Promise<bigint>,
      vault.highWaterMark() as Promise<bigint>,
      vault.executionLogCount() as Promise<bigint>,
    ]);
  return {
    source: "chain-fallback" as const,
    vaultBalance: vaultBalance.toString(),
    riskBalance: riskBalance.toString(),
    totalValue: totalValue.toString(),
    highWaterMark: highWaterMark.toString(),
    totalExecutions: Number(executionLogCount),
  };
}

const PORT = Number(process.env.PORT ?? 8080);
const CYCLE_INTERVAL_MS = Number(process.env.AGENT_INTERVAL_MS ?? AGENT.cycleIntervalMs);

interface VaultState {
  totalIterations: number;
  totalErrors: number;
  lastIterationAt: number | null;
  lastOutcome: IterationOutcome | null;
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

function getOrInitVault(address: string): VaultState {
  const key = address.toLowerCase();
  let s = state.trackedVaults.get(key);
  if (!s) {
    s = { totalIterations: 0, totalErrors: 0, lastIterationAt: null, lastOutcome: null };
    state.trackedVaults.set(key, s);
  }
  return s;
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

  try {
    const market = await pushPrice(ctx);
    const vaults = await discoverVaults(ctx);
    state.lastCycleVaultCount = vaults.length;
    log(`[server] cycle ${state.totalCycles}: ${vaults.length} vault(s) tracked`);

    for (const vaultAddr of vaults) {
      const v = getOrInitVault(vaultAddr);
      v.totalIterations++;
      try {
        const outcome = await executeOneIterationForVault(ctx, vaultAddr, market);
        v.lastOutcome = outcome;
        log(`  ${vaultAddr.slice(0, 10)}... → ${outcome.status}${
          outcome.status === "executed"
            ? ` (${outcome.action})`
            : ":" in outcome
            ? ` (${(outcome as { reason?: string }).reason ?? ""})`
            : ""
        }`);
      } catch (err) {
        v.totalErrors++;
        const reason = err instanceof Error ? err.message : String(err);
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
  const vaults: Record<string, VaultState> = {};
  for (const [addr, s] of state.trackedVaults.entries()) {
    vaults[addr] = s;
  }
  res.json({
    ok: state.agentStatus !== "error",
    agent: state.agentStatus,
    setupError: state.agentSetupError,
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
      runtime,
      portfolio: cache,
    };
  });
  res.json({ count: list.length, vaults: list });
});

app.get("/vault/:address/state", async (req, res) => {
  const addr = req.params.address;
  const runtime = state.trackedVaults.get(addr.toLowerCase()) ?? null;
  const cache = readVaultStateFromCache(addr);
  if (cache || runtime) {
    res.json({ address: addr, runtime, portfolio: cache });
    return;
  }
  // Cache + runtime miss (typical after a Render restart on /tmp). Fall
  // back to a direct chain read so the dashboard does not show "pending".
  if (!ctx) {
    res.status(404).json({ error: "Vault not tracked yet (no cycle has run on it)." });
    return;
  }
  try {
    const portfolio = await readVaultStateFromChain(addr, ctx);
    res.json({ address: addr, runtime: null, portfolio, source: "chain-fallback" });
  } catch (err) {
    res
      .status(404)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
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
  // Cache empty (likely a fresh service instance). Reconstruct from chain.
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
  // Cache miss + no tolerant match. Fall back to on-chain log lookup so the
  // detail view still has something to show.
  if (!ctx) {
    res.status(404).json({ error: "No enriched audit entry cached for this timestamp." });
    return;
  }
  try {
    const onchain = (await readAuditFromChain(addr, ctx, 50)) as Array<{
      timestamp: number;
    }>;
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
    res.json({ ...match, source: "chain-fallback" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
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
