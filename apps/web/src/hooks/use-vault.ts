"use client";

import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { TREASURY_VAULT_ADDRESS, TREASURY_VAULT_ABI, ERC20_ABI, MOCK_USDC_ADDRESS } from "@/config/contracts";
import { parseUnits } from "viem";
import { galileo } from "@/config/wagmi";

const CHAIN_ID = galileo.id;

const vaultContract = {
  address: TREASURY_VAULT_ADDRESS,
  abi: TREASURY_VAULT_ABI,
  chainId: CHAIN_ID,
} as const;

// ── Parsed Vault Data ────────────────────────────────────────────────────

export interface Policy {
  maxAllocationBps: number;
  maxDrawdownBps: number;
  rebalanceThresholdBps: number;
  maxSlippageBps: number;
  cooldownPeriod: number;
  maxPriceStaleness: number;
}

export interface VaultData {
  balance: bigint;       // base (USDC) balance
  riskBalance: bigint;   // risk (WETH) balance
  totalValue: bigint;    // TVL in base units
  highWaterMark: bigint;
  logCount: bigint;
  policy: Policy | null;
  agent: string;
  isKilled: boolean;
  isPaused: boolean;
  owner: string;
  lastExecutionTime: bigint;
}

export function useVaultData() {
  return useReadContracts({
    contracts: [
      { ...vaultContract, functionName: "vaultBalance" },
      { ...vaultContract, functionName: "riskBalance" },
      { ...vaultContract, functionName: "totalValue" },
      { ...vaultContract, functionName: "highWaterMark" },
      { ...vaultContract, functionName: "executionLogCount" },
      { ...vaultContract, functionName: "policy" },
      { ...vaultContract, functionName: "agent" },
      { ...vaultContract, functionName: "killed" },
      { ...vaultContract, functionName: "paused" },
      { ...vaultContract, functionName: "owner" },
      { ...vaultContract, functionName: "lastExecutionTime" },
    ],
    query: { refetchInterval: 10_000 },
  });
}

type PolicyTuple = readonly [number, number, number, number, number, number];

export function useParsedVaultData() {
  const { data, isLoading, isError } = useVaultData();

  const parsed: VaultData | null = data
    ? {
        balance: (data[0]?.result as bigint) ?? 0n,
        riskBalance: (data[1]?.result as bigint) ?? 0n,
        totalValue: (data[2]?.result as bigint) ?? 0n,
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
      }
    : null;

  return { data: parsed, isLoading, isError };
}

// ── Read Hooks ────────────────────────────────────────────────────────────

export function useExecutionLog(index: bigint) {
  return useReadContract({
    ...vaultContract,
    functionName: "executionLogs",
    args: [index],
  });
}

export function useUsdcBalance(address: `0x${string}` | undefined) {
  return useReadContract({
    address: MOCK_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });
}

export function useUsdcAllowance(owner: `0x${string}` | undefined) {
  return useReadContract({
    address: MOCK_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: owner ? [owner, TREASURY_VAULT_ADDRESS] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!owner, refetchInterval: 10_000 },
  });
}

// ── Write Hooks ───────────────────────────────────────────────────────────

export function useApproveUsdc() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function approve(amount: string) {
    writeContract({
      address: MOCK_USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [TREASURY_VAULT_ADDRESS, parseUnits(amount, 6)],
      chainId: CHAIN_ID,
    });
  }

  return { approve, isPending, isConfirming, isSuccess, error, hash };
}

export function useDeposit() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function deposit(amount: string) {
    writeContract({
      ...vaultContract,
      functionName: "deposit",
      args: [parseUnits(amount, 6)],
      chainId: CHAIN_ID,
    });
  }

  return { deposit, isPending, isConfirming, isSuccess, error, hash };
}

export function useWithdraw() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function withdraw(to: `0x${string}`, amount: string) {
    writeContract({
      ...vaultContract,
      functionName: "withdraw",
      args: [to, parseUnits(amount, 6)],
      chainId: CHAIN_ID,
    });
  }

  return { withdraw, isPending, isConfirming, isSuccess, error, hash };
}

export function useEmergencyWithdraw() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function emergencyWithdraw() {
    writeContract({ ...vaultContract, functionName: "emergencyWithdraw", chainId: CHAIN_ID });
  }

  return { emergencyWithdraw, isPending, isConfirming, isSuccess, error, hash };
}

export function usePause() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function pause() {
    writeContract({ ...vaultContract, functionName: "pause", chainId: CHAIN_ID });
  }

  return { pause, isPending, isConfirming, isSuccess, error, hash };
}

export function useUnpause() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function unpause() {
    writeContract({ ...vaultContract, functionName: "unpause", chainId: CHAIN_ID });
  }

  return { unpause, isPending, isConfirming, isSuccess, error, hash };
}

export function useSetPolicy() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function setPolicy(policy: Policy) {
    writeContract({
      ...vaultContract,
      functionName: "setPolicy",
      args: [policy],
      chainId: CHAIN_ID,
    });
  }

  return { setPolicy, isPending, isConfirming, isSuccess, error, hash };
}

export function useMintUsdc() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function mint(to: `0x${string}`, amount: string) {
    writeContract({
      address: MOCK_USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "mint",
      args: [to, parseUnits(amount, 6)],
      chainId: CHAIN_ID,
    });
  }

  return { mint, isPending, isConfirming, isSuccess, error, hash };
}
