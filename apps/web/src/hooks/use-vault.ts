"use client";

import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { TREASURY_VAULT_ADDRESS, TREASURY_VAULT_ABI, ERC20_ABI, MOCK_USDC_ADDRESS } from "@/config/contracts";
import { parseUnits } from "viem";

const vaultContract = {
  address: TREASURY_VAULT_ADDRESS,
  abi: TREASURY_VAULT_ABI,
} as const;

// ── Parsed Vault Data ────────────────────────────────────────────────────

export interface VaultData {
  balance: bigint;
  highWaterMark: bigint;
  logCount: bigint;
  policy: { maxAllocationBps: number; maxDrawdownBps: number; rebalanceThresholdBps: number; cooldownPeriod: number } | null;
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

export function useParsedVaultData() {
  const { data, isLoading, isError } = useVaultData();

  const parsed: VaultData | null = data
    ? {
        balance: (data[0]?.result as bigint) ?? 0n,
        highWaterMark: (data[1]?.result as bigint) ?? 0n,
        logCount: (data[2]?.result as bigint) ?? 0n,
        policy: data[3]?.result
          ? {
              maxAllocationBps: (data[3].result as [number, number, number, number])[0],
              maxDrawdownBps: (data[3].result as [number, number, number, number])[1],
              rebalanceThresholdBps: (data[3].result as [number, number, number, number])[2],
              cooldownPeriod: (data[3].result as [number, number, number, number])[3],
            }
          : null,
        agent: (data[4]?.result as string) ?? "",
        isKilled: (data[5]?.result as boolean) ?? false,
        isPaused: (data[6]?.result as boolean) ?? false,
        owner: (data[7]?.result as string) ?? "",
        lastExecutionTime: (data[8]?.result as bigint) ?? 0n,
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
    query: { enabled: !!address, refetchInterval: 10_000 },
  });
}

export function useUsdcAllowance(owner: `0x${string}` | undefined) {
  return useReadContract({
    address: MOCK_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: owner ? [owner, TREASURY_VAULT_ADDRESS] : undefined,
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
    });
  }

  return { withdraw, isPending, isConfirming, isSuccess, error, hash };
}

export function useEmergencyWithdraw() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function emergencyWithdraw() {
    writeContract({ ...vaultContract, functionName: "emergencyWithdraw" });
  }

  return { emergencyWithdraw, isPending, isConfirming, isSuccess, error, hash };
}

export function usePause() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function pause() {
    writeContract({ ...vaultContract, functionName: "pause" });
  }

  return { pause, isPending, isConfirming, isSuccess, error, hash };
}

export function useUnpause() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function unpause() {
    writeContract({ ...vaultContract, functionName: "unpause" });
  }

  return { unpause, isPending, isConfirming, isSuccess, error, hash };
}

export function useSetPolicy() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  function setPolicy(policy: {
    maxAllocationBps: number;
    maxDrawdownBps: number;
    rebalanceThresholdBps: number;
    cooldownPeriod: number;
  }) {
    writeContract({
      ...vaultContract,
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
      address: MOCK_USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "mint",
      args: [to, parseUnits(amount, 6)],
    });
  }

  return { mint, isPending, isConfirming, isSuccess, error, hash };
}
