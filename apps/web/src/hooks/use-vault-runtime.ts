"use client";

import { useQuery } from "@tanstack/react-query";

export interface VaultRuntime {
  totalIterations: number;
  totalErrors: number;
  lastIterationAt: number | null;
  lastOutcome: { status: string; reason?: string; action?: string } | null;
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
  timestamp: number;
  logIndex: number;
  action: string;
  amount: string;
  intent?: unknown;
  intentHash: string;
  responseHash: string;
  modelResponse?: string;
  signedResponse?: string;
  teeSignature?: string;
  teeSigner: string;
  teeAttestation: string;
  deadline?: number;
  verified: true;
  provider: string;
  model: string;
  verifiability: string;
  chatID: string;
  reasoning: string;
  confidence: number;
  txHash?: string;
  storageTxHash?: string;
  storageRootHash?: string;
  storageError?: string;
  marketSpreadPct?: number;
  marketSourceCount?: number;
  marketRawSources?: Array<{ source: string; ethUsd: number }>;
  priceAttestationPayload?: unknown;
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
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!address,
    refetchInterval: 15_000,
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
      const res = await fetch(`/api/vault-audit?address=${address}&timestamp=${timestamp}`, { cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!address && timestamp !== null,
  });
}
