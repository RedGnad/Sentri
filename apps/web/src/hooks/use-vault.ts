"use client";

import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { TREASURY_VAULT_ABI, ERC20_ABI, MOCK_USDC_ADDRESS } from "@/config/contracts";
import { parseUnits } from "viem";
import { galileo } from "@/config/wagmi";

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

export interface VaultData {
  address: `0x${string}`;
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

type PolicyTuple = readonly [number, number, number, number, number, number];

// ── Read hooks (parameterized by vault address) ──────────────────────────

export function useVaultData(vaultAddress: `0x${string}` | undefined) {
  const enabled = !!vaultAddress && vaultAddress !== "0x";
  return useReadContracts({
    contracts: enabled
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
        ]
      : [],
    query: { enabled, refetchInterval: 10_000 },
  });
}

export function useParsedVaultData(vaultAddress: `0x${string}` | undefined) {
  const { data, isLoading, isError } = useVaultData(vaultAddress);

  const parsed: VaultData | null = data && vaultAddress
    ? {
        address: vaultAddress,
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
    address: MOCK_USDC_ADDRESS,
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
    address: MOCK_USDC_ADDRESS,
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
      address: MOCK_USDC_ADDRESS,
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
      address: MOCK_USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "mint",
      args: [to, parseUnits(amount, 6)],
      chainId: CHAIN_ID,
    });
  }

  return { mint, isPending, isConfirming, isSuccess, error, hash };
}
