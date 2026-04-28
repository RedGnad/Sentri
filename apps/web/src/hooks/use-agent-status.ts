"use client";

import { useQuery } from "@tanstack/react-query";

export interface AgentStatus {
  status: "running" | "idle" | "unavailable";
  message?: string;
  vaultBalance?: string;
  highWaterMark?: string;
  lastAction?: string;
  lastActionTime?: number;
  totalExecutions?: number;
  pnlBps?: number;
}

export function useAgentStatus() {
  return useQuery<AgentStatus>({
    queryKey: ["agent-status"],
    queryFn: () => fetch("/api/agent-status").then((r) => r.json()),
    refetchInterval: 15_000,
  });
}

export interface AuditDetail {
  timestamp: number;
  action: string;
  amount: string;
  proofHash: string;
  teeAttestation: string;
  reasoning: string;
  confidence: number;
  txHash?: string;
  storageTxHash?: string;
  storageRootHash?: string;
}

export function useAuditDetail(timestamp: number | null) {
  return useQuery<AuditDetail>({
    queryKey: ["audit-detail", timestamp],
    queryFn: () =>
      fetch(`/api/audit-detail?timestamp=${timestamp}`).then((r) => {
        if (!r.ok) return null;
        return r.json();
      }),
    enabled: timestamp !== null,
  });
}
