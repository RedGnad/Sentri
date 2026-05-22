"use client";

import { useQuery } from "@tanstack/react-query";

export type VerdictTone = "ok" | "info" | "waiting" | "blocked" | "error";

export interface VaultRuntime {
  totalIterations: number;
  totalErrors: number;
  lastIterationAt: number | null;
  lastOutcome: { status: string; reason?: string; action?: string } | null;
  /** Human-readable explanation of the last cycle outcome (set by the agent server). */
  lastVerdict?: { text: string; tone: VerdictTone } | null;
}

export interface VaultPortfolio {
  vaultBalance: string;
  riskBalance?: string;
  totalValue?: string;
  highWaterMark: string;
  lastAction: string;
  lastActionTime: number;
  totalExecutions: number;
  pnlBps: number;
  marketPrice?: number;
  storageTxHash?: string;
  storageRootHash?: string;
  storageError?: string;
  updatedAt?: number;
}

export interface VaultStateFromAgent {
  address: string;
  runtime: VaultRuntime | null;
  portfolio: VaultPortfolio | null;
}

export interface VaultAuditEntry {
  source?: string;
  timestamp: number;
  logIndex: number;
  action: string;
  amount: string;
  intent?: unknown;
  intentHash: string;
  responseHash: string;
  rawResponseHash?: string;
  signedPayloadHash?: string;
  modelResponse?: string;
  signedResponse?: string;
  teeSignature?: string;
  teeSigner: string;
  recoveredSigner?: string;
  expectedSigner?: string;
  signerMatchedProvider?: boolean;
  teeAttestation: string;
  deadline?: number;
  processResponseVerified?: true;
  verified: true;
  provider: string;
  providerEndpoint?: string;
  model: string;
  verifiability: string;
  chatID: string;
  reasoning: string;
  confidence: number;
  txHash?: string;
  storageTxHash?: string;
  storageRootHash?: string;
  storageError?: string;
  canonicalRootHash?: string;
  canonicalStorageTxHash?: string;
  canonicalRecordHash?: string;
  kvIndexRootHash?: string;
  kvIndexTxHash?: string;
  canonicalStorageError?: string;
  kvIndexError?: string;
  marketSpreadPct?: number;
  marketSourceCount?: number;
  marketRequiredSourceCount?: number;
  marketRawSources?: Array<{ source: string; priceUsd?: number; ethUsd: number }>;
  priceAttestationPayload?: unknown;
}

export interface VaultRejectionEntry {
  timestamp: number;
  type: "defensive-override" | "onchain-revert" | "agent-sizing" | "tee-signer-mismatch" | "audit-storage";
  phase?: "state-read" | "estimateGas" | "executeStrategy";
  reason: string;
  errorCode?: string;
  action?: string;
  intentHash?: string;
  txHash?: string;
  priceAgeSec?: number;
  maxPriceStaleness?: number;
  safeNoFundsMoved?: boolean;
  verdict?: string;
  vaultAddress: string;
}

/**
 * Live runtime + portfolio for a specific vault, fetched from the agent
 * server's /vault/:address/state endpoint via our API proxy.
 */
export function useVaultStateFromAgent(address: `0x${string}` | undefined) {
  return useQuery<VaultStateFromAgent | null>({
    queryKey: ["vault-state", address?.toLowerCase()],
    queryFn: async () => {
      if (!address) return null;
      const res = await fetch(`/api/vault-state?address=${address}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to fetch vault state: ${res.status}`);
      return res.json();
    },
    enabled: !!address,
    refetchInterval: 15_000,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

/**
 * Blocked-action log: rejected executions (on-chain reverts + agent-side defensive overrides).
 */
export function useVaultRejections(address: `0x${string}` | undefined) {
  return useQuery<{ count: number; entries: VaultRejectionEntry[] } | null>({
    queryKey: ["vault-rejections", address?.toLowerCase()],
    queryFn: async () => {
      if (!address) return null;
      const res = await fetch(`/api/vault-rejections?address=${address}`, { cache: "no-store" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!address,
    refetchInterval: 30_000,
  });
}

/**
 * Enriched audit detail for one execution timestamp on one vault.
 */
export function useVaultAuditDetail(address: `0x${string}` | undefined, timestamp: number | null) {
  return useQuery<VaultAuditEntry | null>({
    queryKey: ["vault-audit-detail", address?.toLowerCase(), timestamp],
    queryFn: async () => {
      if (!address || timestamp === null) return null;
      const params = new URLSearchParams({
        address,
        timestamp: timestamp.toString(),
      });
      const res = await fetch(`/api/vault-audit?${params.toString()}`, { cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!address && timestamp !== null,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    // Enriched reasoning is written by the agent shortly after execution. Poll
    // until it appears, then stop. Bounded (~10 polls ≈ 25s) so a genuinely
    // un-indexed entry (e.g. a chain-only fallback log) does not poll forever.
    refetchInterval: (query) => {
      if (query.state.data?.reasoning) return false;
      if (query.state.dataUpdateCount >= 10) return false;
      return 2_500;
    },
  });
}
