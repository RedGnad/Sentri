// Server-side probes for the landing page. Reads live data from:
//   - 0G Galileo RPC (latest block, vault state)
//   - The agent server (/healthz endpoint)
//
// Returns "unavailable" markers when a probe fails, never throws — so the
// landing page can render even if one source is down.

import { createPublicClient, http } from "viem";
import { TREASURY_VAULT_ADDRESS, TREASURY_VAULT_ABI } from "@/config/contracts";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 16602);
const AGENT_URL = process.env.AGENT_URL ?? process.env.NEXT_PUBLIC_AGENT_URL;
const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://chainscan-galileo.0g.ai";

export interface LiveSnapshot {
  chain: {
    id: number;
    blockNumber: number | null;
    blockAgeSec: number | null;
    rpcOk: boolean;
  };
  vault: {
    totalValue: string | null; // formatted USDC e.g. "10056.39"
    executionLogCount: number | null;
    isPaused: boolean | null;
    isKilled: boolean | null;
  };
  agent: {
    ok: boolean;
    status: "ready" | "initializing" | "error" | "unreachable";
    walletAddress: string | null;
    model: string | null;
    totalIterations: number | null;
    lastIterationAt: number | null;
    lastIterationStatus: "ok" | "error" | "skipped" | null;
    intervalSec: number | null;
    uptimeSec: number | null;
    error: string | null;
  };
  links: {
    explorer: string;
    vaultAddress: string;
  };
  fetchedAt: number;
}

async function probeChainAndVault(): Promise<{
  chain: LiveSnapshot["chain"];
  vault: LiveSnapshot["vault"];
}> {
  const baseChain = { id: CHAIN_ID, blockNumber: null, blockAgeSec: null, rpcOk: false };
  const baseVault = {
    totalValue: null,
    executionLogCount: null,
    isPaused: null,
    isKilled: null,
  };

  if (!TREASURY_VAULT_ADDRESS || TREASURY_VAULT_ADDRESS === "0x") {
    return { chain: baseChain, vault: baseVault };
  }

  try {
    const client = createPublicClient({
      transport: http(RPC_URL, { timeout: 5_000, retryCount: 0 }),
    });

    const [block, totalValue, logCount, isPaused, isKilled] = await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.readContract({
        address: TREASURY_VAULT_ADDRESS as `0x${string}`,
        abi: TREASURY_VAULT_ABI,
        functionName: "totalValue",
      }),
      client.readContract({
        address: TREASURY_VAULT_ADDRESS as `0x${string}`,
        abi: TREASURY_VAULT_ABI,
        functionName: "executionLogCount",
      }),
      client.readContract({
        address: TREASURY_VAULT_ADDRESS as `0x${string}`,
        abi: TREASURY_VAULT_ABI,
        functionName: "paused",
      }),
      client.readContract({
        address: TREASURY_VAULT_ADDRESS as `0x${string}`,
        abi: TREASURY_VAULT_ABI,
        functionName: "killed",
      }),
    ]);

    const blockTimestamp = Number(block.timestamp);
    const blockAgeSec = Math.max(0, Math.floor(Date.now() / 1000 - blockTimestamp));

    return {
      chain: {
        id: CHAIN_ID,
        blockNumber: Number(block.number),
        blockAgeSec,
        rpcOk: true,
      },
      vault: {
        totalValue: (Number(totalValue as bigint) / 1e6).toFixed(2),
        executionLogCount: Number(logCount as bigint),
        isPaused: isPaused as boolean,
        isKilled: isKilled as boolean,
      },
    };
  } catch {
    return { chain: baseChain, vault: baseVault };
  }
}

async function probeAgent(): Promise<LiveSnapshot["agent"]> {
  if (!AGENT_URL) {
    return {
      ok: false,
      status: "unreachable",
      walletAddress: null,
      model: null,
      totalIterations: null,
      lastIterationAt: null,
      lastIterationStatus: null,
      intervalSec: null,
      uptimeSec: null,
      error: "AGENT_URL not configured",
    };
  }

  try {
    const res = await fetch(`${AGENT_URL.replace(/\/$/, "")}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        status: "unreachable",
        walletAddress: null,
        model: null,
        totalIterations: null,
        lastIterationAt: null,
        lastIterationStatus: null,
        intervalSec: null,
        uptimeSec: null,
        error: `HTTP ${res.status}`,
      };
    }
    const body = await res.json();
    return {
      ok: body.ok === true,
      status: body.agent ?? "unreachable",
      walletAddress: body.config?.walletAddress ?? null,
      model: body.config?.model ?? null,
      totalIterations: body.iterations?.total ?? null,
      lastIterationAt: body.iterations?.lastAt ?? null,
      lastIterationStatus: body.iterations?.lastStatus ?? null,
      intervalSec: body.config?.intervalSec ?? null,
      uptimeSec: body.uptimeSec ?? null,
      error: body.iterations?.lastError ?? body.setupError ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      status: "unreachable",
      walletAddress: null,
      model: null,
      totalIterations: null,
      lastIterationAt: null,
      lastIterationStatus: null,
      intervalSec: null,
      uptimeSec: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getLiveSnapshot(): Promise<LiveSnapshot> {
  const [{ chain, vault }, agent] = await Promise.all([probeChainAndVault(), probeAgent()]);
  return {
    chain,
    vault,
    agent,
    links: {
      explorer: EXPLORER,
      vaultAddress: TREASURY_VAULT_ADDRESS,
    },
    fetchedAt: Date.now(),
  };
}

export function formatRelative(timestampMs: number | null): string {
  if (!timestampMs) return "—";
  const ageSec = Math.floor((Date.now() - timestampMs) / 1000);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}
