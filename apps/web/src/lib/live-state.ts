// Server-side probes for the landing page (public observatory).
// Reads protocol-wide live data from:
//   - selected 0G RPC (latest block, factory state, aggregate vault TVL)
//   - The agent server (/healthz endpoint with cycle counters)
//
// Returns "unavailable" markers when a probe fails, never throws — so the
// landing renders even if a source is down.

import { createPublicClient, http } from "viem";
import {
  VAULT_FACTORY_ADDRESS,
  VAULT_FACTORY_ABI,
  TREASURY_VAULT_ABI,
} from "@/config/contracts";

const IS_MAINNET = process.env.NEXT_PUBLIC_SENTRI_NETWORK === "mainnet";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? (IS_MAINNET ? "https://evmrpc.0g.ai" : "https://evmrpc-testnet.0g.ai");
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? (IS_MAINNET ? 16661 : 16602));
const AGENT_URL = process.env.AGENT_URL ?? process.env.NEXT_PUBLIC_AGENT_URL;
const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? (IS_MAINNET ? "https://chainscan.0g.ai" : "https://chainscan-galileo.0g.ai");

export interface LiveSnapshot {
  chain: {
    id: number;
    blockNumber: number | null;
    blockAgeSec: number | null;
    rpcOk: boolean;
  };
  protocol: {
    factoryAddress: string;
    vaultsCount: number | null;
    totalTVL: string | null; // formatted USDC, e.g. "120,453.21"
    totalExecutions: number | null;
  };
  agent: {
    ok: boolean;
    status: "ready" | "initializing" | "error" | "unreachable";
    walletAddress: string | null;
    model: string | null;
    cycles: number | null;
    lastCycleAt: number | null;
    intervalSec: number | null;
    uptimeSec: number | null;
    trackedVaultCount: number | null;
    error: string | null;
  };
  links: {
    explorer: string;
    factoryExplorer: string;
  };
  fetchedAt: number;
}

async function probeChainAndProtocol(): Promise<{
  chain: LiveSnapshot["chain"];
  protocol: LiveSnapshot["protocol"];
}> {
  const baseChain = { id: CHAIN_ID, blockNumber: null, blockAgeSec: null, rpcOk: false };
  const baseProtocol = {
    factoryAddress: VAULT_FACTORY_ADDRESS,
    vaultsCount: null,
    totalTVL: null,
    totalExecutions: null,
  };

  if (!VAULT_FACTORY_ADDRESS || VAULT_FACTORY_ADDRESS === "0x") {
    return { chain: baseChain, protocol: baseProtocol };
  }

  try {
    const client = createPublicClient({
      transport: http(RPC_URL, { timeout: 5_000, retryCount: 0 }),
    });

    const [block, count] = await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.readContract({
        address: VAULT_FACTORY_ADDRESS,
        abi: VAULT_FACTORY_ABI,
        functionName: "vaultsCount",
      }) as Promise<bigint>,
    ]);

    const blockTimestamp = Number(block.timestamp);
    const blockAgeSec = Math.max(0, Math.floor(Date.now() / 1000 - blockTimestamp));

    const vaultsCount = Number(count);

    // Aggregate TVL + executions across all vaults (capped at 50 for sanity).
    let totalTVL = 0n;
    let totalExecutions = 0;
    if (vaultsCount > 0) {
      const limit = Math.min(vaultsCount, 50);
      const addrs = (await client.readContract({
        address: VAULT_FACTORY_ADDRESS,
        abi: VAULT_FACTORY_ABI,
        functionName: "vaultsPage",
        args: [0n, BigInt(limit)],
      })) as readonly `0x${string}`[];

      const tvlReads = addrs.map((addr) =>
        client.readContract({
          address: addr,
          abi: TREASURY_VAULT_ABI,
          functionName: "totalValue",
        }) as Promise<bigint>,
      );
      const logReads = addrs.map((addr) =>
        client.readContract({
          address: addr,
          abi: TREASURY_VAULT_ABI,
          functionName: "executionLogCount",
        }) as Promise<bigint>,
      );
      const tvlResults = await Promise.allSettled(tvlReads);
      const logResults = await Promise.allSettled(logReads);
      for (const r of tvlResults) {
        if (r.status === "fulfilled") totalTVL += r.value;
      }
      for (const r of logResults) {
        if (r.status === "fulfilled") totalExecutions += Number(r.value);
      }
    }

    return {
      chain: {
        id: CHAIN_ID,
        blockNumber: Number(block.number),
        blockAgeSec,
        rpcOk: true,
      },
      protocol: {
        factoryAddress: VAULT_FACTORY_ADDRESS,
        vaultsCount,
        totalTVL: (Number(totalTVL) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }),
        totalExecutions,
      },
    };
  } catch {
    return { chain: baseChain, protocol: baseProtocol };
  }
}

async function probeAgent(): Promise<LiveSnapshot["agent"]> {
  const empty: LiveSnapshot["agent"] = {
    ok: false,
    status: "unreachable",
    walletAddress: null,
    model: null,
    cycles: null,
    lastCycleAt: null,
    intervalSec: null,
    uptimeSec: null,
    trackedVaultCount: null,
    error: null,
  };

  if (!AGENT_URL) return { ...empty, error: "AGENT_URL not configured" };

  try {
    const res = await fetch(`${AGENT_URL.replace(/\/$/, "")}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { ...empty, error: `HTTP ${res.status}` };
    const body = await res.json();
    return {
      ok: body.ok === true,
      status: body.agent ?? "unreachable",
      walletAddress: body.config?.walletAddress ?? null,
      model: body.config?.model ?? null,
      cycles: body.cycles?.total ?? null,
      lastCycleAt: body.cycles?.lastAt ?? null,
      intervalSec: body.config?.intervalSec ?? null,
      uptimeSec: body.uptimeSec ?? null,
      trackedVaultCount: body.trackedVaultCount ?? null,
      error: body.setupError ?? null,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getLiveSnapshot(): Promise<LiveSnapshot> {
  const [{ chain, protocol }, agent] = await Promise.all([probeChainAndProtocol(), probeAgent()]);
  return {
    chain,
    protocol,
    agent,
    links: {
      explorer: EXPLORER,
      factoryExplorer: `${EXPLORER}/address/${VAULT_FACTORY_ADDRESS}`,
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
