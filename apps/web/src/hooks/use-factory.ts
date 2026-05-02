"use client";

import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import {
  VAULT_FACTORY_ADDRESS,
  VAULT_FACTORY_ABI,
} from "@/config/contracts";
import { galileo } from "@/config/wagmi";
import type { Policy } from "./use-vault";

const CHAIN_ID = galileo.id;

const factoryContract = {
  address: VAULT_FACTORY_ADDRESS,
  abi: VAULT_FACTORY_ABI,
  chainId: CHAIN_ID,
} as const;

// ── Reads ────────────────────────────────────────────────────────────────

export function useVaultsCount() {
  return useReadContract({
    ...factoryContract,
    functionName: "vaultsCount",
    query: { refetchInterval: 15_000 },
  });
}

/**
 * Fetch a paginated page of vault addresses from the factory.
 */
export function useVaultsPage(start: bigint, limit: bigint) {
  return useReadContract({
    ...factoryContract,
    functionName: "vaultsPage",
    args: [start, limit],
    query: { refetchInterval: 30_000 },
  });
}

/**
 * Fetch the list of vault addresses owned by a given account.
 */
export function useVaultsByOwner(account: `0x${string}` | undefined) {
  return useReadContract({
    ...factoryContract,
    functionName: "vaultsByOwner",
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 15_000 },
  });
}

export function useVaultsByOwnerCount(account: `0x${string}` | undefined) {
  return useReadContract({
    ...factoryContract,
    functionName: "vaultsByOwnerCount",
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 15_000 },
  });
}

/**
 * Get a preview of the policy that would be applied for a given preset tier.
 */
export function usePresetPolicyPreview(tier: number) {
  return useReadContract({
    ...factoryContract,
    functionName: "previewPresetPolicy",
    args: [tier],
    query: { enabled: tier !== 3 }, // Custom has no preview
  });
}

// ── Writes ───────────────────────────────────────────────────────────────

export function useCreateVault() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  function createPreset(tier: number) {
    writeContract({ ...factoryContract, functionName: "createVault", args: [tier] });
  }

  function createPresetAndDeposit(tier: number, depositAmount: string) {
    const amount = parseUnits(depositAmount, 6);
    writeContract({ ...factoryContract, functionName: "createVaultAndDeposit", args: [tier, amount] });
  }

  function createCustom(policy: Policy) {
    writeContract({
      ...factoryContract,
      functionName: "createVaultWithCustomPolicy",
      args: [policy],
    });
  }

  function createCustomAndDeposit(policy: Policy, depositAmount: string) {
    const amount = parseUnits(depositAmount, 6);
    writeContract({
      ...factoryContract,
      functionName: "createVaultWithCustomPolicyAndDeposit",
      args: [policy, amount],
    });
  }

  return {
    createPreset,
    createPresetAndDeposit,
    createCustom,
    createCustomAndDeposit,
    isPending,
    isConfirming,
    isSuccess,
    error,
    hash,
    receipt,
    reset,
  };
}
