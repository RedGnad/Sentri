// HTTP wrapper around the Sentri agent loop.
// Exposes a /healthz endpoint so an external uptime pinger
// (cron-job.org / UptimeRobot) can keep the host awake on a
// free-tier PaaS that sleeps idle services.

import "dotenv/config";
import express from "express";
import { setupAgent, executeOneIteration, log, type AgentContext } from "./agent.js";

const PORT = Number(process.env.PORT ?? 8080);
const ITERATION_INTERVAL_MS = Number(process.env.AGENT_INTERVAL_MS ?? 5 * 60_000);

interface ServerState {
  startedAt: number;
  lastIterationAt: number | null;
  lastIterationStatus: "ok" | "error" | "skipped" | null;
  lastIterationError: string | null;
  totalIterations: number;
  totalErrors: number;
  agentStatus: "initializing" | "ready" | "error";
  agentSetupError: string | null;
}

const state: ServerState = {
  startedAt: Date.now(),
  lastIterationAt: null,
  lastIterationStatus: null,
  lastIterationError: null,
  totalIterations: 0,
  totalErrors: 0,
  agentStatus: "initializing",
  agentSetupError: null,
};

let agentContext: AgentContext | null = null;
let isRunning = false;

async function runOneIteration(): Promise<void> {
  if (!agentContext) {
    log("[server] runOneIteration called before agent ready — skipping.");
    return;
  }
  if (isRunning) {
    log("[server] previous iteration still running — skipping tick.");
    return;
  }
  isRunning = true;
  state.totalIterations++;
  try {
    await executeOneIteration(agentContext);
    state.lastIterationStatus = "ok";
    state.lastIterationError = null;
  } catch (err) {
    state.lastIterationStatus = "error";
    state.lastIterationError = err instanceof Error ? err.message : String(err);
    state.totalErrors++;
    log(`[server] iteration error: ${state.lastIterationError}`);
  } finally {
    state.lastIterationAt = Date.now();
    isRunning = false;
  }
}

const app = express();

app.get("/healthz", (_req, res) => {
  res.json({
    ok: state.agentStatus !== "error",
    agent: state.agentStatus,
    setupError: state.agentSetupError,
    iterations: {
      total: state.totalIterations,
      errors: state.totalErrors,
      lastAt: state.lastIterationAt,
      lastStatus: state.lastIterationStatus,
      lastError: state.lastIterationError,
      isRunning,
    },
    config: {
      intervalSec: ITERATION_INTERVAL_MS / 1000,
      walletAddress: agentContext?.walletAddress ?? null,
      provider: agentContext?.providerInfo?.address ?? null,
      model: agentContext?.providerInfo?.model ?? null,
    },
    uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
  });
});

app.get("/", (_req, res) => res.redirect("/healthz"));

app.listen(PORT, () => {
  log(`[server] listening on :${PORT}`);
  log(`[server] interval = ${ITERATION_INTERVAL_MS / 1000}s`);
  log("[server] initializing agent (Sealed Inference broker + Storage)...");

  setupAgent()
    .then((ctx) => {
      agentContext = ctx;
      state.agentStatus = "ready";
      log("[server] agent ready. Scheduling iterations.");
      setInterval(runOneIteration, ITERATION_INTERVAL_MS);
      // Kick off immediately so the first /healthz already shows activity.
      void runOneIteration();
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      state.agentStatus = "error";
      state.agentSetupError = msg;
      log(`[server] FATAL setup error: ${msg}`);
    });
});

// Graceful shutdown so Render sees clean signals.
process.on("SIGTERM", () => {
  log("[server] SIGTERM received, exiting.");
  process.exit(0);
});
process.on("SIGINT", () => {
  log("[server] SIGINT received, exiting.");
  process.exit(0);
});
