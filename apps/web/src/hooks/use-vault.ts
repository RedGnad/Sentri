"use client";

import { useEffect, useState } from "react";
import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import {
  TREASURY_VAULT_ABI,
  TREASURY_VAULT_V2_ABI,
  ERC20_ABI,
  BASE_TOKEN_ADDRESS,
  PRICE_FEED_ADDRESS,
  PRICE_FEED_ABI,
  TRUSTLESS_VAULT,
} from "@/config/contracts";
import { parseUnits } from "viem";
import { galileo } from "@/config/wagmi";
import { fetchPythMarketPrice, quoteRiskToBaseUnits } from "@/lib/v2-market-price";

const CHAIN_ID = galileo.id;

// ── Types ────────────────────────────────────────────────────────────────

export interface Policy {
  maxAllocationBps: number;
  maxDrawdownBps: number;
  rebalanceThresholdBps: number;
  maxSlippageBps: number;
  cooldownPeriod: number;
  maxPriceStaleness: number;
}

export type VaultTier = "standard" | "v2";
export type TvlStatus = "ready" | "estimating";

export interface VaultData {
  address: `0x${string}`;
  tier: VaultTier;
  balance: bigint;       // base (USDC) balance
  riskBalance: bigint;   // risk (WETH) balance
  totalValue: bigint;    // TVL in base units
  tvlStatus: TvlStatus;
  highWaterMark: bigint;
  logCount: bigint;
  policy: Policy | null;
  agent: string;
  isKilled: boolean;
  isPaused: boolean;
  owner: string;
  lastExecutionTime: bigint;
  pythPriceId: string | null;
  oracleMode: number | null;
  pyth: string | null;
}

type PolicyTuple = readonly [number, number, number, number, number, number];

// ── Read hooks (parameterized by vault address) ──────────────────────────

function useV2RiskQuote(
  enabled: boolean,
  riskBalance: bigint,
  priceId: string | null,
) {
  const [quote, setQuote] = useState<bigint | null>(null);

  useEffect(() => {
    if (!enabled || riskBalance <= 0n || !priceId) {
      setQuote(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    const currentPriceId = priceId;
    let cancelled = false;

    async function loadPrice() {
      const price = await fetchPythMarketPrice(currentPriceId, { signal: controller.signal });
      if (cancelled) return;
      setQuote(price ? quoteRiskToBaseUnits(riskBalance, price) : null);
    }

    loadPrice();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, priceId, riskBalance]);

  return quote;
}

export function useVaultData(
  vaultAddress: `0x${string}` | undefined,
  tierHint?: VaultTier,
) {
  const enabled = !!vaultAddress && vaultAddress !== "0x";
  const v2Probe = useReadContract({
    address: vaultAddress,
    abi: TREASURY_VAULT_V2_ABI,
    chainId: CHAIN_ID,
    functionName: "pythPriceId",
    query: {
      enabled: enabled && !tierHint,
      retry: false,
    },
  });

  const detectedTier: VaultTier | undefined =
    tierHint ?? (v2Probe.data ? "v2" : v2Probe.isError || v2Probe.isFetched ? "standard" : undefined);
  const isV2 = detectedTier === "v2";
  const isStandard = detectedTier === "standard";
  const isDetecting = enabled && !tierHint && !detectedTier;

  const standardRead = useReadContracts({
    contracts: enabled && isStandard
      ? [
          { address: vaultAddress, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "vaultBalance" },
          { address: vaultAddress, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "riskBalance" },
          { address: vaultAddress, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "totalValue" },
          { address: vaultAddress, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "highWaterMark" },
          { address: vaultAddress, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "executionLogCount" },
          { address: vaultAddress, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "policy" },
          { address: vaultAddress, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "agent" },
          { address: vaultAddress, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "killed" },
          { address: vaultAddress, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "paused" },
          { address: vaultAddress, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "owner" },
          { address: vaultAddress, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "lastExecutionTime" },
          { address: PRICE_FEED_ADDRESS, abi: PRICE_FEED_ABI, chainId: CHAIN_ID, functionName: "latestRoundData" },
          { address: PRICE_FEED_ADDRESS, abi: PRICE_FEED_ABI, chainId: CHAIN_ID, functionName: "decimals" },
        ]
      : [],
    query: { enabled: enabled && isStandard, refetchInterval: 10_000 },
  });

  const v2Read = useReadContracts({
    contracts: enabled && isV2
      ? [
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "vaultBalance" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "riskBalance" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "executionLogCount" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "policy" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "agent" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "owner" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "highWaterMark" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "paused" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "killed" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "lastExecutionTime" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "pythPriceId" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "oracleMode" },
          { address: vaultAddress, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "pyth" },
        ]
      : [],
    query: { enabled: enabled && isV2, refetchInterval: 10_000 },
  });

  const activeRead = isV2 ? v2Read : standardRead;

  return {
    data: activeRead.data,
    isLoading: isDetecting || activeRead.isLoading,
    isError: activeRead.isError,
    tier: detectedTier,
  };
}

export function useParsedVaultData(
  vaultAddress: `0x${string}` | undefined,
  tierHint?: VaultTier,
) {
  const { data, isLoading, isError, tier } = useVaultData(vaultAddress, tierHint);
  const v2BaseBal = (tier === "v2" ? (data?.[0]?.result as bigint | undefined) : undefined) ?? 0n;
  const v2RiskBal = (tier === "v2" ? (data?.[1]?.result as bigint | undefined) : undefined) ?? 0n;
  const v2PriceId =
    tier === "v2"
      ? ((data?.[10]?.result as string | undefined) ?? TRUSTLESS_VAULT.pythFeedId)
      : null;
  const v2RiskQuote = useV2RiskQuote(tier === "v2", v2RiskBal, v2PriceId);

  const parsed: VaultData | null = data && vaultAddress && tier
    ? tier === "v2"
      ? parseV2VaultData({
          address: vaultAddress,
          data,
          baseBal: v2BaseBal,
          riskBal: v2RiskBal,
          riskQuote: v2RiskQuote,
          priceId: v2PriceId,
        })
      : parseStandardVaultData(vaultAddress, data)
    : null;

  return { data: parsed, isLoading, isError };
}

function parseStandardVaultData(
  vaultAddress: `0x${string}`,
  data: readonly { result?: unknown }[],
): VaultData {
  // Standard vaults expose totalValue(). If that read reverts on a stale
  // oracle, fall back to balances plus the raw price feed read.
  const baseBal = (data?.[0]?.result as bigint | undefined) ?? 0n;
  const riskBal = (data?.[1]?.result as bigint | undefined) ?? 0n;
  const onchainTotalValue = (data?.[2]?.result as bigint | undefined) ?? 0n;
  const priceTuple = data?.[11]?.result as
    | readonly [bigint, bigint, bigint, bigint, bigint]
    | undefined;
  const priceDecimals = data?.[12]?.result as number | undefined;

  let totalValue = onchainTotalValue;
  if (totalValue === 0n && (baseBal > 0n || riskBal > 0n)) {
    if (priceTuple && priceDecimals !== undefined && priceTuple[1] > 0n) {
      const riskQuoteDivisor = 10n ** BigInt(18 + Number(priceDecimals) - 6);
      totalValue = baseBal + (riskBal * priceTuple[1]) / riskQuoteDivisor;
    } else {
      totalValue = baseBal;
    }
  }

  return {
    address: vaultAddress,
    tier: "standard",
    balance: baseBal,
    riskBalance: riskBal,
    totalValue,
    tvlStatus: "ready",
    highWaterMark: (data[3]?.result as bigint) ?? 0n,
    logCount: (data[4]?.result as bigint) ?? 0n,
    policy: data[5]?.result
      ? {
          maxAllocationBps: (data[5].result as PolicyTuple)[0],
          maxDrawdownBps: (data[5].result as PolicyTuple)[1],
          rebalanceThresholdBps: (data[5].result as PolicyTuple)[2],
          maxSlippageBps: (data[5].result as PolicyTuple)[3],
          cooldownPeriod: (data[5].result as PolicyTuple)[4],
          maxPriceStaleness: (data[5].result as PolicyTuple)[5],
        }
      : null,
    agent: (data[6]?.result as string) ?? "",
    isKilled: (data[7]?.result as boolean) ?? false,
    isPaused: (data[8]?.result as boolean) ?? false,
    owner: (data[9]?.result as string) ?? "",
    lastExecutionTime: (data[10]?.result as bigint) ?? 0n,
    pythPriceId: null,
    oracleMode: null,
    pyth: null,
  };
}

function parseV2VaultData({
  address,
  data,
  baseBal,
  riskBal,
  riskQuote,
  priceId,
}: {
  address: `0x${string}`;
  data: readonly { result?: unknown }[];
  baseBal: bigint;
  riskBal: bigint;
  riskQuote: bigint | null;
  priceId: string | null;
}): VaultData {
  const tvlStatus: TvlStatus = riskBal > 0n && riskQuote === null ? "estimating" : "ready";

  return {
    address,
    tier: "v2",
    balance: baseBal,
    riskBalance: riskBal,
    totalValue: baseBal + (riskQuote ?? 0n),
    tvlStatus,
    highWaterMark: (data[6]?.result as bigint) ?? 0n,
    logCount: (data[2]?.result as bigint) ?? 0n,
    policy: data[3]?.result
      ? {
          maxAllocationBps: (data[3].result as PolicyTuple)[0],
          maxDrawdownBps: (data[3].result as PolicyTuple)[1],
          rebalanceThresholdBps: (data[3].result as PolicyTuple)[2],
          maxSlippageBps: (data[3].result as PolicyTuple)[3],
          cooldownPeriod: (data[3].result as PolicyTuple)[4],
          maxPriceStaleness: (data[3].result as PolicyTuple)[5],
        }
      : null,
    agent: (data[4]?.result as string) ?? "",
    isKilled: (data[8]?.result as boolean) ?? false,
    isPaused: (data[7]?.result as boolean) ?? false,
    owner: (data[5]?.result as string) ?? "",
    lastExecutionTime: (data[9]?.result as bigint) ?? 0n,
    pythPriceId: priceId,
    oracleMode: (data[11]?.result as number | undefined) ?? null,
    pyth: (data[12]?.result as string | undefined) ?? null,
  };
}

export function useExecutionLog(vaultAddress: `0x${string}` | undefined, index: bigint) {
  return useReadContract({
    address: vaultAddress,
    abi: TREASURY_VAULT_ABI,
    chainId: CHAIN_ID,
    functionName: "executionLogs",
    args: [index],
    query: { enabled: !!vaultAddress },
  });
}

// ── ERC20 reads ──────────────────────────────────────────────────────────

export function useUsdcBalance(address: `0x${string}` | undefined) {
  return useReadContract({
    address: BASE_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });
}

/**
 * Allowance from `owner` to a specific `spender` (vault or factory).
 */
export function useUsdcAllowance(
  owner: `0x${string}` | undefined,
  spender: `0x${string}` | undefined,
) {
  return useReadContract({
    address: BASE_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: owner && spender ? [owner, spender] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!owner && !!spender, refetchInterval: 10_000 },
  });
}

// ── Write hooks (parameterized by vault address where relevant) ──────────

/**
 * Approve a specific spender (vault for deposits, factory for atomic deposits).
 */
export function useApproveUsdc() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function approve(spender: `0x${string}`, amount: string) {
    writeContract({
      address: BASE_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, parseUnits(amount, 6)],
      chainId: CHAIN_ID,
    });
  }

  return { approve, isPending, isConfirming, isSuccess, error, hash };
}

export function useDeposit() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function deposit(vaultAddress: `0x${string}`, amount: string) {
    writeContract({
      address: vaultAddress,
      abi: TREASURY_VAULT_ABI,
      chainId: CHAIN_ID,
      functionName: "deposit",
      args: [parseUnits(amount, 6)],
    });
  }

  return { deposit, isPending, isConfirming, isSuccess, error, hash };
}

export function useWithdraw() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function withdraw(vaultAddress: `0x${string}`, to: `0x${string}`, amount: string) {
    writeContract({
      address: vaultAddress,
      abi: TREASURY_VAULT_ABI,
      chainId: CHAIN_ID,
      functionName: "withdraw",
      args: [to, parseUnits(amount, 6)],
    });
  }

  return { withdraw, isPending, isConfirming, isSuccess, error, hash };
}

export function useEmergencyWithdraw() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function emergencyWithdraw(vaultAddress: `0x${string}`) {
    writeContract({
      address: vaultAddress,
      abi: TREASURY_VAULT_ABI,
      chainId: CHAIN_ID,
      functionName: "emergencyWithdraw",
    });
  }

  return { emergencyWithdraw, isPending, isConfirming, isSuccess, error, hash };
}

export function useEmergencyDeleverageAndWithdraw() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function emergencyDeleverageAndWithdraw(vaultAddress: `0x${string}`, minBaseOut: bigint = 0n) {
    writeContract({
      address: vaultAddress,
      abi: TREASURY_VAULT_ABI,
      chainId: CHAIN_ID,
      functionName: "emergencyDeleverageAndWithdraw",
      args: [minBaseOut],
    });
  }

  return { emergencyDeleverageAndWithdraw, isPending, isConfirming, isSuccess, error, hash };
}

export function usePause() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function pause(vaultAddress: `0x${string}`) {
    writeContract({
      address: vaultAddress,
      abi: TREASURY_VAULT_ABI,
      chainId: CHAIN_ID,
      functionName: "pause",
    });
  }

  return { pause, isPending, isConfirming, isSuccess, error, hash };
}

export function useUnpause() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function unpause(vaultAddress: `0x${string}`) {
    writeContract({
      address: vaultAddress,
      abi: TREASURY_VAULT_ABI,
      chainId: CHAIN_ID,
      functionName: "unpause",
    });
  }

  return { unpause, isPending, isConfirming, isSuccess, error, hash };
}

export function useSetPolicy() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function setPolicy(vaultAddress: `0x${string}`, policy: Policy) {
    writeContract({
      address: vaultAddress,
      abi: TREASURY_VAULT_ABI,
      chainId: CHAIN_ID,
      functionName: "setPolicy",
      args: [policy],
    });
  }

  return { setPolicy, isPending, isConfirming, isSuccess, error, hash };
}

export function useMintUsdc() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function mint(to: `0x${string}`, amount: string) {
    writeContract({
      address: BASE_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "mint",
      args: [to, parseUnits(amount, 6)],
      chainId: CHAIN_ID,
    });
  }

  return { mint, isPending, isConfirming, isSuccess, error, hash };
}
