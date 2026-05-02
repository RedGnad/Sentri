// HTTP wrapper around the Sentri agent loop.
//
// Exposes:
//   GET /healthz       — liveness + iteration counters (ping target for uptime cron)
//   GET /state         — latest portfolio state snapshot (agent's local cache mirror)
//   GET /audit         — list of cached audit entries (most recent first)
//   GET /audit/:ts     — single enriched audit entry (reasoning, confidence, storage tx)
//
// The agent writes the canonical record to 0G Storage. The endpoints below serve
// the local cache mirror — every entry includes its 0G Storage tx + root hash so
// any consumer can independently verify on https://storagescan-galileo.0g.ai.

import "dotenv/config";
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { setupAgent, executeOneIteration, log, type AgentContext } from "./agent.js";

const PORT = Number(process.env.PORT ?? 8080);
const ITERATION_INTERVAL_MS = Number(process.env.AGENT_INTERVAL_MS ?? 5 * 60_000);
const CACHE_DIR = process.env.SENTRI_CACHE_DIR ?? "/tmp/sentri-cache";

interface ServerState {
  startedAt: number;
  lastIterationAt: number | null;
  lastIterationStatus: "ok" | "error" | "skipped" | null;
  lastIterationError: string | null;
  totalIterations: number;
  totalErrors: number;
  llmParseFailures: number;
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
  llmParseFailures: 0,
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

// ── Helpers for cache reads ──────────────────────────────────────────────

function readStateFile(): Record<string, unknown> | null {
  const file = path.join(CACHE_DIR, "state.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function readAuditFile(timestamp: string): Record<string, unknown> | null {
  const file = path.join(CACHE_DIR, "audit", `${timestamp}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function listAuditFiles(limit = 50): string[] {
  const dir = path.join(CACHE_DIR, "audit");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""))
    .sort((a, b) => Number(b) - Number(a))
    .slice(0, limit);
}

// ── App ──────────────────────────────────────────────────────────────────

const app = express();

// Permissive CORS — the dashboard reads this server from a different origin
// (Vercel / localhost). All endpoints are read-only and serve public chain
// data, so wildcard CORS is acceptable.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/healthz", (_req, res) => {
  res.json({
    ok: state.agentStatus !== "error",
    agent: state.agentStatus,
    setupError: state.agentSetupError,
    iterations: {
      total: state.totalIterations,
      errors: state.totalErrors,
      llmParseFailures: state.llmParseFailures,
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

app.get("/state", (_req, res) => {
  const cached = readStateFile();
  if (!cached) {
    res.json({
      status: state.agentStatus === "ready" ? "idle" : "unavailable",
      message:
        state.agentStatus === "ready"
          ? "Agent has not produced a portfolio snapshot yet."
          : "Agent setup failed or not ready.",
      runtime: {
        agent: state.agentStatus,
        lastIterationAt: state.lastIterationAt,
        totalExecutions: 0,
      },
    });
    return;
  }

  const updatedAt = Number(cached.updatedAt ?? cached.lastActionTime ?? 0);
  const ageMs = Date.now() - updatedAt;
  const status = ageMs < ITERATION_INTERVAL_MS * 3 ? "running" : "idle";

  res.json({
    status,
    ...cached,
    runtime: {
      agent: state.agentStatus,
      lastIterationAt: state.lastIterationAt,
      totalIterations: state.totalIterations,
      totalErrors: state.totalErrors,
    },
  });
});

app.get("/audit", (_req, res) => {
  const timestamps = listAuditFiles(50);
  const entries = timestamps
    .map((ts) => readAuditFile(ts))
    .filter((e): e is Record<string, unknown> => e !== null);
  res.json({ count: entries.length, entries });
});

app.get("/audit/:timestamp", (req, res) => {
  const ts = req.params.timestamp;
  const entry = readAuditFile(ts);
  if (!entry) {
    res
      .status(404)
      .json({ error: "No enriched audit entry cached for this timestamp." });
    return;
  }
  res.json(entry);
});

app.get("/", (_req, res) => res.redirect("/healthz"));

app.listen(PORT, () => {
  log(`[server] listening on :${PORT}`);
  log(`[server] interval = ${ITERATION_INTERVAL_MS / 1000}s`);
  log(`[server] cache dir = ${CACHE_DIR}`);
  log("[server] initializing agent (Sealed Inference broker + Storage)...");

  setupAgent()
    .then((ctx) => {
      agentContext = ctx;
      state.agentStatus = "ready";
      log("[server] agent ready. Scheduling iterations.");
      setInterval(runOneIteration, ITERATION_INTERVAL_MS);
      void runOneIteration();
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
