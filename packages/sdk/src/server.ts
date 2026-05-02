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
import { AGENT } from "./constants.js";

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

app.get("/vault/:address/state", (req, res) => {
  const addr = req.params.address;
  const runtime = state.trackedVaults.get(addr.toLowerCase()) ?? null;
  const cache = readVaultStateFromCache(addr);
  if (!cache && !runtime) {
    res.status(404).json({ error: "Vault not tracked yet (no cycle has run on it)." });
    return;
  }
  res.json({
    address: addr,
    runtime,
    portfolio: cache,
  });
});

app.get("/vault/:address/audit", (req, res) => {
  const addr = req.params.address;
  const timestamps = listVaultAuditFromCache(addr, 50);
  const entries = timestamps
    .map((ts) => readVaultAuditFromCache(addr, ts))
    .filter((e): e is NonNullable<typeof e> => e !== null);
  res.json({ address: addr, count: entries.length, entries });
});

app.get("/vault/:address/audit/:timestamp", (req, res) => {
  const addr = req.params.address;
  const ts = req.params.timestamp;
  let entry = readVaultAuditFromCache(addr, ts);
  if (!entry) {
    const closest = findClosestVaultAudit(addr, Number(ts));
    if (closest) entry = readVaultAuditFromCache(addr, closest);
  }
  if (!entry) {
    res.status(404).json({ error: "No enriched audit entry cached for this timestamp." });
    return;
  }
  res.json(entry);
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
