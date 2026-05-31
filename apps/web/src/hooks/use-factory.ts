"use client";

import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import {
  VAULT_FACTORY_ADDRESS,
  VAULT_FACTORY_ABI,
  VAULT_FACTORY_V2_ABI,
  TREASURY_VAULT_ABI,
  TREASURY_VAULT_V2_ABI,
  TRUSTLESS_VAULT,
} from "@/config/contracts";
import { galileo } from "@/config/wagmi";
import type { Policy, VaultTier } from "./use-vault";

const CHAIN_ID = galileo.id;

const factoryContract = {
  address: VAULT_FACTORY_ADDRESS,
  abi: VAULT_FACTORY_ABI,
  chainId: CHAIN_ID,
} as const;

const factoryV2Contract = {
  address: TRUSTLESS_VAULT.factory as `0x${string}`,
  abi: VAULT_FACTORY_V2_ABI,
  chainId: CHAIN_ID,
} as const;

export interface VaultDirectoryItem {
  address: `0x${string}`;
  tier: VaultTier;
}

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
export function useVaultsPage(start: bigint, limit: bigint, enabled = true) {
  return useReadContract({
    ...factoryContract,
    functionName: "vaultsPage",
    args: [start, limit],
    query: { enabled, refetchInterval: 30_000 },
  });
}

export function useVaultsV2Page(start: bigint, limit?: bigint) {
  const enabled = CHAIN_ID === 16661;
  const count = useReadContract({
    ...factoryV2Contract,
    functionName: "vaultCount",
    query: {
      enabled,
      refetchInterval: 30_000,
      retry: false,
    },
  });
  const countNum = count.data ? Number(count.data) : 0;
  const startNum = Number(start);
  const requestedLimit = limit === undefined ? countNum : Number(limit);
  const readCount = Math.max(0, Math.min(requestedLimit, countNum - startNum));
  const contracts = Array.from({ length: readCount }, (_, i) => ({
    ...factoryV2Contract,
    functionName: "allVaults" as const,
    args: [BigInt(startNum + i)] as const,
  }));
  const page = useReadContracts({
    contracts,
    query: {
      enabled: enabled && count.isSuccess && readCount > 0,
      refetchInterval: 30_000,
      retry: false,
    },
  });
  const vaults =
    page.data
      ?.map((entry) => entry.result as `0x${string}` | undefined)
      .filter((addr): addr is `0x${string}` => !!addr) ?? [];

  return {
    data: vaults,
    isLoading: enabled && (count.isLoading || (readCount > 0 && page.isLoading)),
    totalRaw: countNum,
  };
}

export function useActiveVaultsPage(start: bigint, limit?: bigint) {
  const standardCount = useVaultsCount();
  const standardLimit = limit ?? ((standardCount.data as bigint | undefined) ?? 0n);
  const standardPageEnabled = limit !== undefined || standardCount.isSuccess;
  const page = useVaultsPage(start, standardLimit, standardPageEnabled);
  const vaults = (page.data as readonly `0x${string}`[] | undefined) ?? [];
  const v2Page = useVaultsV2Page(start, limit);
  const v2Vaults = v2Page.data;
  const statuses = useReadContracts({
    contracts: vaults.flatMap((address) => [
      { address, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "killed" as const },
      { address, abi: TREASURY_VAULT_ABI, chainId: CHAIN_ID, functionName: "paused" as const },
    ]),
    query: { enabled: vaults.length > 0, refetchInterval: 30_000 },
  });
  const v2Statuses = useReadContracts({
    contracts: v2Vaults.flatMap((address) => [
      { address, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "killed" as const },
      { address, abi: TREASURY_VAULT_V2_ABI, chainId: CHAIN_ID, functionName: "paused" as const },
    ]),
    query: { enabled: v2Vaults.length > 0, refetchInterval: 30_000, retry: false },
  });
  // Paused vaults stay in the directory listing so users (and judges)
  // can see vaults that aren't currently auto-cycled but are still on
  // chain — useful state, not noise. Killed vaults still get filtered
  // out because their funds have been withdrawn and there is nothing
  // left to inspect. The per-vault StatusDot will render "Paused" so
  // the row's state is obvious to the reader.
  const statusesReady = vaults.length === 0 || !!statuses.data;
  const activeStandardVaults = statusesReady
    ? vaults.filter((_, i) => {
        const killed = statuses.data?.[i * 2]?.result as boolean | undefined;
        return killed !== true;
      })
    : [];
  const v2StatusesReady = v2Vaults.length === 0 || !!v2Statuses.data;
  const activeV2Vaults = v2StatusesReady
    ? v2Vaults.filter((_, i) => {
        const killed = v2Statuses.data?.[i * 2]?.result as boolean | undefined;
        return killed !== true;
      })
    : [];
  const activeVaults: VaultDirectoryItem[] = [
    ...activeStandardVaults.map((address) => ({ address, tier: "standard" as const })),
    ...activeV2Vaults.map((address) => ({ address, tier: "v2" as const })),
  ];
  return {
    data: activeVaults,
    isLoading:
      standardCount.isLoading ||
      page.isLoading ||
      v2Page.isLoading ||
      (vaults.length > 0 && statuses.isLoading) ||
      (v2Vaults.length > 0 && v2Statuses.isLoading),
    totalRaw: Number((standardCount.data as bigint | undefined) ?? 0n) + v2Page.totalRaw,
  };
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

/**
 * Create a Trustless Oracle (V2) vault via VaultFactoryV2. Minimal surface
 * for the in-panel create wizard — preset only, no deposit step. The user
 * deposits after creation from the vault detail page; the existing
 * useDeposit hook works for V2 since TreasuryVaultTrustlessOracle.deposit()
 * has the same signature as V1.
 */
export function useCreateV2Vault() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  function createPreset(tier: number) {
    writeContract({ ...factoryV2Contract, functionName: "createVault", args: [tier] });
  }

  return {
    createPreset,
    isPending,
    isConfirming,
    isSuccess,
    error,
    hash,
    receipt,
    reset,
  };
}

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
