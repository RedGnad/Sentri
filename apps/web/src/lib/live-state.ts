// Server-side probes for the landing page (public observatory).
// Reads protocol-wide live data from:
//   - selected 0G RPC (latest block, factory state, aggregate vault TVL)
//   - The agent server (/healthz endpoint with cycle counters)
//
// Returns "unavailable" markers when a probe fails, never throws — so the
// landing renders even if a source is down.

import { createPublicClient, http } from "viem";
import {
  PRICE_FEED_ABI,
  PRICE_FEED_ADDRESS,
  VAULT_FACTORY_ADDRESS,
  VAULT_FACTORY_ABI,
  VAULT_FACTORY_V2_ABI,
  TREASURY_VAULT_ABI,
  TREASURY_VAULT_V2_ABI,
  TRUSTLESS_VAULT,
  LEGACY_VAULT_FACTORY_ADDRESS,
  LEGACY_V2_VAULT_FACTORY_ADDRESS,
} from "@/config/contracts";
import { fetchPythMarketPrice, quoteRiskToBaseUnits } from "@/lib/v2-market-price";

const IS_MAINNET = process.env.NEXT_PUBLIC_SENTRI_NETWORK === "mainnet";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? (IS_MAINNET ? "https://evmrpc.0g.ai" : "https://evmrpc-testnet.0g.ai");
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? (IS_MAINNET ? 16661 : 16602));
const AGENT_URL = process.env.AGENT_URL ?? process.env.NEXT_PUBLIC_AGENT_URL;
const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? (IS_MAINNET ? "https://chainscan.0g.ai" : "https://chainscan-galileo.0g.ai");
const TRUSTLESS_FACTORY_ADDRESS = TRUSTLESS_VAULT.factory as `0x${string}`;

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
    standardVaultsCount: number | null;
    v2VaultsCount: number | null;
    totalTVL: string | null; // formatted USDC, e.g. "120,453.21"
    totalTVLStatus: "ready" | "estimating" | "unavailable";
    standardExecutions: number | null;
    v2Executions: number | null;
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
    build: { gitSha: string | null; gitBranch: string | null } | null;
  };
  links: {
    explorer: string;
    factoryExplorer: string;
  };
  // Build provenance for the deployed web app, so an operator can confirm the
  // live dashboard matches the intended commit. Vercel injects
  // VERCEL_GIT_COMMIT_SHA / VERCEL_GIT_COMMIT_REF automatically.
  build: { gitSha: string | null; gitBranch: string | null };
  fetchedAt: number;
}

type PublicClient = ReturnType<typeof createPublicClient>;
type ProtocolTvlStatus = LiveSnapshot["protocol"]["totalTVLStatus"];

interface ProtocolAggregate {
  vaultsCount: number | null;
  totalTVL: bigint | null;
  tvlStatus: ProtocolTvlStatus;
  totalExecutions: number | null;
}

function emptyProtocol(): LiveSnapshot["protocol"] {
  return {
    factoryAddress: VAULT_FACTORY_ADDRESS,
    vaultsCount: null,
    standardVaultsCount: null,
    v2VaultsCount: null,
    totalTVL: null,
    totalTVLStatus: "unavailable",
    standardExecutions: null,
    v2Executions: null,
    totalExecutions: null,
  };
}

function formatBaseUnits(value: bigint): string {
  return (Number(value) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function combineNullableCounts(a: number | null, b: number | null): number | null {
  return a !== null && b !== null ? a + b : null;
}

async function readStandardProtocolStats(client: PublicClient): Promise<ProtocolAggregate> {
  if (!VAULT_FACTORY_ADDRESS || VAULT_FACTORY_ADDRESS === "0x") {
    return { vaultsCount: null, totalTVL: null, tvlStatus: "unavailable", totalExecutions: null };
  }

  try {
    const count = (await client.readContract({
      address: VAULT_FACTORY_ADDRESS,
      abi: VAULT_FACTORY_ABI,
      functionName: "vaultsCount",
    })) as bigint;

    const vaultsCount = Number(count);
    if (vaultsCount === 0) {
      return { vaultsCount: 0, totalTVL: 0n, tvlStatus: "ready", totalExecutions: 0 };
    }

    const addrs = (await client.readContract({
      address: VAULT_FACTORY_ADDRESS,
      abi: VAULT_FACTORY_ABI,
      functionName: "vaultsPage",
      args: [0n, BigInt(vaultsCount)],
    })) as readonly `0x${string}`[];

    const statusReads = addrs.flatMap((addr) => [
      client.readContract({
        address: addr,
        abi: TREASURY_VAULT_ABI,
        functionName: "killed",
      }) as Promise<boolean>,
      client.readContract({
        address: addr,
        abi: TREASURY_VAULT_ABI,
        functionName: "paused",
      }) as Promise<boolean>,
    ]);
    const statusResults = await Promise.allSettled(statusReads);
    const activeAddrs = addrs.filter((_, i) => {
      const killed = statusResults[i * 2];
      const paused = statusResults[i * 2 + 1];
      return !(
        (killed?.status === "fulfilled" && killed.value) ||
        (paused?.status === "fulfilled" && paused.value)
      );
    });

    const tvlReads = activeAddrs.map((addr) =>
      client.readContract({
        address: addr,
        abi: TREASURY_VAULT_ABI,
        functionName: "totalValue",
      }) as Promise<bigint>,
    );
    const logReads = activeAddrs.map((addr) =>
      client.readContract({
        address: addr,
        abi: TREASURY_VAULT_ABI,
        functionName: "executionLogCount",
      }) as Promise<bigint>,
    );
    const balanceReads = activeAddrs.flatMap((addr) => [
      client.readContract({
        address: addr,
        abi: TREASURY_VAULT_ABI,
        functionName: "vaultBalance",
      }) as Promise<bigint>,
      client.readContract({
        address: addr,
        abi: TREASURY_VAULT_ABI,
        functionName: "riskBalance",
      }) as Promise<bigint>,
    ]);
    const priceCallSettled = Promise.allSettled([
      client.readContract({
        address: PRICE_FEED_ADDRESS,
        abi: PRICE_FEED_ABI,
        functionName: "latestRoundData",
      }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
      client.readContract({
        address: PRICE_FEED_ADDRESS,
        abi: PRICE_FEED_ABI,
        functionName: "decimals",
      }) as Promise<number>,
    ]);

    const [tvlResults, logResults, balanceResults, priceSettled] = await Promise.all([
      Promise.allSettled(tvlReads),
      Promise.allSettled(logReads),
      Promise.allSettled(balanceReads),
      priceCallSettled,
    ]);

    let totalTVL = 0n;
    let totalExecutions = 0;
    let failedLogReads = 0;
    let successfulTvlReads = 0;
    let fallbackTotalTVL = 0n;
    let successfulFallbackTvlReads = 0;

    for (const r of tvlResults) {
      if (r.status === "fulfilled") {
        successfulTvlReads += 1;
        totalTVL += r.value;
      }
    }
    for (const r of logResults) {
      if (r.status === "fulfilled") totalExecutions += Number(r.value);
      else failedLogReads += 1;
    }

    const priceRaw = priceSettled[0];
    const decimalsRaw = priceSettled[1];
    if (priceRaw.status === "fulfilled" && decimalsRaw.status === "fulfilled") {
      const price = priceRaw.value[1];
      const decimals = decimalsRaw.value;
      if (price > 0n) {
        const riskQuoteDivisor = 10n ** BigInt(18 + Number(decimals) - 6);
        for (let i = 0; i < activeAddrs.length; i += 1) {
          const baseResult = balanceResults[i * 2];
          const riskResult = balanceResults[i * 2 + 1];
          if (baseResult?.status === "fulfilled" && riskResult?.status === "fulfilled") {
            fallbackTotalTVL += baseResult.value + (riskResult.value * price) / riskQuoteDivisor;
            successfulFallbackTvlReads += 1;
          }
        }
      }
    }

    const tvlForDisplay = successfulTvlReads > 0 ? totalTVL : fallbackTotalTVL;
    const successfulDisplayTvlReads =
      successfulTvlReads > 0 ? successfulTvlReads : successfulFallbackTvlReads;

    return {
      vaultsCount: activeAddrs.length,
      totalTVL:
        activeAddrs.length === 0 || successfulDisplayTvlReads > 0 ? tvlForDisplay : null,
      tvlStatus:
        activeAddrs.length === 0 || successfulDisplayTvlReads > 0 ? "ready" : "unavailable",
      totalExecutions: failedLogReads === 0 ? totalExecutions : null,
    };
  } catch {
    return { vaultsCount: null, totalTVL: null, tvlStatus: "unavailable", totalExecutions: null };
  }
}

async function readV2ProtocolStats(client: PublicClient): Promise<ProtocolAggregate> {
  if (!IS_MAINNET) {
    return { vaultsCount: 0, totalTVL: 0n, tvlStatus: "ready", totalExecutions: 0 };
  }

  try {
    const count = (await client.readContract({
      address: TRUSTLESS_FACTORY_ADDRESS,
      abi: VAULT_FACTORY_V2_ABI,
      functionName: "vaultCount",
    })) as bigint;

    const vaultsCount = Number(count);
    if (vaultsCount === 0) {
      return { vaultsCount: 0, totalTVL: 0n, tvlStatus: "ready", totalExecutions: 0 };
    }

    const addrsSettled = await Promise.allSettled(
      Array.from({ length: vaultsCount }, (_, i) =>
        client.readContract({
          address: TRUSTLESS_FACTORY_ADDRESS,
          abi: VAULT_FACTORY_V2_ABI,
          functionName: "allVaults",
          args: [BigInt(i)],
        }) as Promise<`0x${string}`>,
      ),
    );
    const addrs = addrsSettled
      .filter((r): r is PromiseFulfilledResult<`0x${string}`> => r.status === "fulfilled")
      .map((r) => r.value);

    const statusReads = addrs.flatMap((addr) => [
      client.readContract({
        address: addr,
        abi: TREASURY_VAULT_V2_ABI,
        functionName: "killed",
      }) as Promise<boolean>,
      client.readContract({
        address: addr,
        abi: TREASURY_VAULT_V2_ABI,
        functionName: "paused",
      }) as Promise<boolean>,
    ]);
    const statusResults = await Promise.allSettled(statusReads);
    const activeAddrs = addrs.filter((_, i) => {
      const killed = statusResults[i * 2];
      const paused = statusResults[i * 2 + 1];
      return !(
        (killed?.status === "fulfilled" && killed.value) ||
        (paused?.status === "fulfilled" && paused.value)
      );
    });

    const balanceReads = activeAddrs.flatMap((addr) => [
      client.readContract({
        address: addr,
        abi: TREASURY_VAULT_V2_ABI,
        functionName: "vaultBalance",
      }) as Promise<bigint>,
      client.readContract({
        address: addr,
        abi: TREASURY_VAULT_V2_ABI,
        functionName: "riskBalance",
      }) as Promise<bigint>,
    ]);
    const logReads = activeAddrs.map((addr) =>
      client.readContract({
        address: addr,
        abi: TREASURY_VAULT_V2_ABI,
        functionName: "executionLogCount",
      }) as Promise<bigint>,
    );
    const [balanceResults, logResults] = await Promise.all([
      Promise.allSettled(balanceReads),
      Promise.allSettled(logReads),
    ]);

    let totalTVL = 0n;
    let totalExecutions = 0;
    let failedBalanceReads = 0;
    let failedLogReads = 0;
    let hasRisk = false;

    const balances: Array<{ base: bigint; risk: bigint }> = [];
    for (let i = 0; i < activeAddrs.length; i += 1) {
      const baseResult = balanceResults[i * 2];
      const riskResult = balanceResults[i * 2 + 1];
      if (baseResult?.status === "fulfilled" && riskResult?.status === "fulfilled") {
        balances.push({ base: baseResult.value, risk: riskResult.value });
        if (riskResult.value > 0n) hasRisk = true;
      } else {
        failedBalanceReads += 1;
      }
    }

    for (const r of logResults) {
      if (r.status === "fulfilled") totalExecutions += Number(r.value);
      else failedLogReads += 1;
    }

    const marketPrice = hasRisk
      ? await fetchPythMarketPrice(TRUSTLESS_VAULT.pythFeedId, {
          signal: AbortSignal.timeout(4_000),
        })
      : null;

    if (failedBalanceReads > 0) {
      return {
        vaultsCount: activeAddrs.length,
        totalTVL: null,
        tvlStatus: "unavailable",
        totalExecutions: failedLogReads === 0 ? totalExecutions : null,
      };
    }

    if (hasRisk && !marketPrice) {
      return {
        vaultsCount: activeAddrs.length,
        totalTVL: null,
        tvlStatus: "estimating",
        totalExecutions: failedLogReads === 0 ? totalExecutions : null,
      };
    }

    for (const balance of balances) {
      totalTVL += balance.base;
      if (balance.risk > 0n && marketPrice) {
        totalTVL += quoteRiskToBaseUnits(balance.risk, marketPrice);
      }
    }

    return {
      vaultsCount: activeAddrs.length,
      totalTVL,
      tvlStatus: "ready",
      totalExecutions: failedLogReads === 0 ? totalExecutions : null,
    };
  } catch {
    return { vaultsCount: null, totalTVL: null, tvlStatus: "unavailable", totalExecutions: null };
  }
}

// Reads execution counts from the previous standard factory, including killed
// vaults, to preserve historical on-chain execution history after migration.
async function readLegacyExecutionCount(client: PublicClient): Promise<number | null> {
  try {
    const count = (await client.readContract({
      address: LEGACY_VAULT_FACTORY_ADDRESS as `0x${string}`,
      abi: VAULT_FACTORY_ABI,
      functionName: "vaultsCount",
    })) as bigint;

    const vaultsCount = Number(count);
    if (vaultsCount === 0) return 0;

    const addrs = (await client.readContract({
      address: LEGACY_VAULT_FACTORY_ADDRESS as `0x${string}`,
      abi: VAULT_FACTORY_ABI,
      functionName: "vaultsPage",
      args: [0n, BigInt(vaultsCount)],
    })) as readonly `0x${string}`[];

    const results = await Promise.allSettled(
      addrs.map((addr) =>
        client.readContract({
          address: addr,
          abi: TREASURY_VAULT_ABI,
          functionName: "executionLogCount",
        }) as Promise<bigint>,
      ),
    );

    let total = 0;
    for (const r of results) {
      if (r.status === "fulfilled") total += Number(r.value);
    }
    return total;
  } catch {
    return null;
  }
}

// Same idea as readLegacyExecutionCount, for the previous V2 (trustless oracle)
// factory: aggregate execution history across all its vaults so the V2 counter
// stays consistent with the V1 one after migration.
async function readLegacyV2ExecutionCount(client: PublicClient): Promise<number | null> {
  if (!IS_MAINNET) return 0;
  try {
    const count = (await client.readContract({
      address: LEGACY_V2_VAULT_FACTORY_ADDRESS as `0x${string}`,
      abi: VAULT_FACTORY_V2_ABI,
      functionName: "vaultCount",
    })) as bigint;

    const vaultsCount = Number(count);
    if (vaultsCount === 0) return 0;

    const addrsSettled = await Promise.allSettled(
      Array.from({ length: vaultsCount }, (_, i) =>
        client.readContract({
          address: LEGACY_V2_VAULT_FACTORY_ADDRESS as `0x${string}`,
          abi: VAULT_FACTORY_V2_ABI,
          functionName: "allVaults",
          args: [BigInt(i)],
        }) as Promise<`0x${string}`>,
      ),
    );
    const addrs = addrsSettled
      .filter((r): r is PromiseFulfilledResult<`0x${string}`> => r.status === "fulfilled")
      .map((r) => r.value);

    const results = await Promise.allSettled(
      addrs.map((addr) =>
        client.readContract({
          address: addr,
          abi: TREASURY_VAULT_V2_ABI,
          functionName: "executionLogCount",
        }) as Promise<bigint>,
      ),
    );

    let total = 0;
    for (const r of results) {
      if (r.status === "fulfilled") total += Number(r.value);
    }
    return total;
  } catch {
    return null;
  }
}

async function probeChainAndProtocol(): Promise<{
  chain: LiveSnapshot["chain"];
  protocol: LiveSnapshot["protocol"];
}> {
  const baseChain = { id: CHAIN_ID, blockNumber: null, blockAgeSec: null, rpcOk: false };
  const baseProtocol = emptyProtocol();

  try {
    const client = createPublicClient({
      transport: http(RPC_URL, { timeout: 5_000, retryCount: 0 }),
    });

    const block = await client.getBlock({ blockTag: "latest" });
    const blockTimestamp = Number(block.timestamp);
    const blockAgeSec = Math.max(0, Math.floor(Date.now() / 1000 - blockTimestamp));
    const chain = {
      id: CHAIN_ID,
      blockNumber: Number(block.number),
      blockAgeSec,
      rpcOk: true,
    };

    const [standard, v2, legacyExecs, legacyV2Execs] = await Promise.all([
      readStandardProtocolStats(client),
      readV2ProtocolStats(client),
      readLegacyExecutionCount(client),
      readLegacyV2ExecutionCount(client),
    ]);
    const totalTVLStatus: ProtocolTvlStatus =
      standard.tvlStatus === "unavailable" || v2.tvlStatus === "unavailable"
        ? "unavailable"
        : standard.tvlStatus === "estimating" || v2.tvlStatus === "estimating"
          ? "estimating"
          : "ready";
    const totalTVL =
      totalTVLStatus === "ready" && standard.totalTVL !== null && v2.totalTVL !== null
        ? standard.totalTVL + v2.totalTVL
        : null;

    const standardPlusLegacy = combineNullableCounts(standard.totalExecutions, legacyExecs);
    const v2PlusLegacy = combineNullableCounts(v2.totalExecutions, legacyV2Execs);

    return {
      chain,
      protocol: {
        factoryAddress: VAULT_FACTORY_ADDRESS,
        vaultsCount: combineNullableCounts(standard.vaultsCount, v2.vaultsCount),
        standardVaultsCount: standard.vaultsCount,
        v2VaultsCount: v2.vaultsCount,
        totalTVL: totalTVL !== null ? formatBaseUnits(totalTVL) : null,
        totalTVLStatus,
        standardExecutions: standardPlusLegacy,
        v2Executions: v2PlusLegacy,
        totalExecutions: combineNullableCounts(standardPlusLegacy, v2PlusLegacy),
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
    build: null,
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
      build: body.build ?? null,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getLiveSnapshot(): Promise<LiveSnapshot> {
  const [{ chain, protocol }, agent] = await Promise.all([probeChainAndProtocol(), probeAgent()]);
  const protocolWithAgentFallback = {
    ...protocol,
    vaultsCount:
      protocol.vaultsCount ?? (agent.trackedVaultCount !== null ? agent.trackedVaultCount : null),
  };

  return {
    chain,
    protocol: protocolWithAgentFallback,
    agent,
    links: {
      explorer: EXPLORER,
      factoryExplorer: `${EXPLORER}/address/${VAULT_FACTORY_ADDRESS}`,
    },
    build: {
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.SENTRI_GIT_SHA ?? null,
      gitBranch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
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
