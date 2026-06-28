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
  LEGACY_VAULT_FACTORY_ADDRESS,
  LEGACY_V2_VAULT_FACTORY_ADDRESS,
  LEGACY_V2_STANDARD_VAULT_FACTORY_ADDRESS,
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

const legacyFactoryContract = {
  address: LEGACY_VAULT_FACTORY_ADDRESS as `0x${string}`,
  abi: VAULT_FACTORY_ABI,
  chainId: CHAIN_ID,
} as const;

const legacyV2FactoryContract = {
  address: LEGACY_V2_VAULT_FACTORY_ADDRESS as `0x${string}`,
  abi: VAULT_FACTORY_V2_ABI,
  chainId: CHAIN_ID,
} as const;

// Previous v2 STANDARD factory (pre multi-operator). Same ABI/tier as the
// active standard factory; its vaults now belong in the legacy section.
const legacyV2StandardFactoryContract = {
  address: LEGACY_V2_STANDARD_VAULT_FACTORY_ADDRESS as `0x${string}`,
  abi: VAULT_FACTORY_ABI,
  chainId: CHAIN_ID,
} as const;

export function useLegacyV2StandardVaults() {
  const count = useReadContract({
    ...legacyV2StandardFactoryContract,
    functionName: "vaultsCount",
    query: { refetchInterval: 60_000, retry: false },
  });
  const countNum = count.data ? Number(count.data as bigint) : 0;
  const page = useReadContract({
    ...legacyV2StandardFactoryContract,
    functionName: "vaultsPage",
    args: [0n, BigInt(countNum)],
    query: { enabled: count.isSuccess && countNum > 0, refetchInterval: 60_000, retry: false },
  });
  return (page.data as readonly `0x${string}`[] | undefined) ?? [];
}

export function useLegacyV2StandardVaultsByOwner(account: `0x${string}` | undefined) {
  return useReadContract({
    ...legacyV2StandardFactoryContract,
    functionName: "vaultsByOwner",
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 60_000, retry: false },
  });
}

export function useLegacyVaultsByOwner(account: `0x${string}` | undefined) {
  return useReadContract({
    ...legacyFactoryContract,
    functionName: "vaultsByOwner",
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 60_000, retry: false },
  });
}

export function useLegacyV2Vaults() {
  const count = useReadContract({
    ...legacyV2FactoryContract,
    functionName: "vaultCount",
    query: { refetchInterval: 60_000, retry: false },
  });
  const countNum = count.data ? Number(count.data as bigint) : 0;
  const contracts = Array.from({ length: countNum }, (_, i) => ({
    ...legacyV2FactoryContract,
    functionName: "allVaults" as const,
    args: [BigInt(i)] as const,
  }));
  const page = useReadContracts({
    contracts,
    query: { enabled: count.isSuccess && countNum > 0, refetchInterval: 60_000, retry: false },
  });
  return (
    page.data
      ?.map((e) => e.result as `0x${string}` | undefined)
      .filter((a): a is `0x${string}` => !!a) ?? []
  );
}

export function useLegacyV2VaultsByOwner(account: `0x${string}` | undefined) {
  return useReadContract({
    ...legacyV2FactoryContract,
    functionName: "vaultsByOwner",
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 60_000, retry: false },
  });
}

export function useV2VaultsByOwner(account: `0x${string}` | undefined) {
  return useReadContract({
    ...factoryV2Contract,
    functionName: "vaultsByOwner",
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 30_000, retry: false },
  });
}

export function useLegacyVaults() {
  const count = useReadContract({
    ...legacyFactoryContract,
    functionName: "vaultsCount",
    query: { refetchInterval: 60_000, retry: false },
  });
  const countNum = count.data ? Number(count.data as bigint) : 0;
  const page = useReadContract({
    ...legacyFactoryContract,
    functionName: "vaultsPage",
    args: [0n, BigInt(countNum)],
    query: { enabled: count.isSuccess && countNum > 0, refetchInterval: 60_000, retry: false },
  });
  return (page.data as readonly `0x${string}`[] | undefined) ?? [];
}

/**
 * From a list of legacy vaults, keep only those that still hold funds. Drained
 * legacy vaults (emergency-withdrawn to zero) are hidden from the public
 * directory — owners still find them on the My Vaults page, which does not use
 * this filter. Returns [] until balances load, so empties never flash in.
 */
export function useNonEmptyLegacyVaults(items: VaultDirectoryItem[]): VaultDirectoryItem[] {
  const contracts = items.flatMap(({ address, tier }) => {
    const abi = tier === "v2" ? TREASURY_VAULT_V2_ABI : TREASURY_VAULT_ABI;
    return [
      { address, abi, chainId: CHAIN_ID, functionName: "vaultBalance" as const },
      { address, abi, chainId: CHAIN_ID, functionName: "riskBalance" as const },
    ];
  });
  const { data } = useReadContracts({
    contracts,
    query: { enabled: items.length > 0, refetchInterval: 60_000, retry: false },
  });
  if (!data) return [];
  return items.filter((_, i) => {
    const base = (data[i * 2]?.result as bigint | undefined) ?? 0n;
    const risk = (data[i * 2 + 1]?.result as bigint | undefined) ?? 0n;
    return base + risk > 0n;
  });
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
  const statusesReady = vaults.length === 0 || !!statuses.data;
  const standardAlive = statusesReady
    ? vaults
        .map((address, i) => ({
          address,
          killed: statuses.data?.[i * 2]?.result as boolean | undefined,
          paused: (statuses.data?.[i * 2 + 1]?.result as boolean | undefined) === true,
        }))
        .filter((v) => v.killed !== true)
    : [];
  const v2StatusesReady = v2Vaults.length === 0 || !!v2Statuses.data;
  const v2Alive = v2StatusesReady
    ? v2Vaults
        .map((address, i) => ({
          address,
          killed: v2Statuses.data?.[i * 2]?.result as boolean | undefined,
          paused: (v2Statuses.data?.[i * 2 + 1]?.result as boolean | undefined) === true,
        }))
        .filter((v) => v.killed !== true)
    : [];
  const all = [
    ...standardAlive.map((v) => ({ address: v.address, paused: v.paused, tier: "standard" as const })),
    ...v2Alive.map((v) => ({ address: v.address, paused: v.paused, tier: "v2" as const })),
  ];
  // Stable sort: live (paused=false) before paused (paused=true). Within
  // each group, the factory's discovery order is preserved.
  all.sort((a, b) => Number(a.paused) - Number(b.paused));
  const activeVaults: VaultDirectoryItem[] = all.map(({ address, tier }) => ({ address, tier }));
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
