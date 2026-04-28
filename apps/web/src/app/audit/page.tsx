"use client";

import { useState } from "react";
import { useReadContracts } from "wagmi";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TREASURY_VAULT_ADDRESS, TREASURY_VAULT_ABI } from "@/config/contracts";
import { formatUSDC } from "@/lib/utils";
import { FileText, ExternalLink, ChevronDown, ChevronUp, Brain, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useParsedVaultData } from "@/hooks/use-vault";
import { useAuditDetail } from "@/hooks/use-agent-status";

const ACTION_LABELS = ["Rebalance", "YieldFarm", "EmergencyDeleverage"] as const;
const ACTION_VARIANTS = ["default", "success", "destructive"] as const;

function AuditEntry({
  index,
  logCount,
  timestamp,
  action,
  amountIn,
  amountOut,
  tvlAfter,
  proofHash,
  teeAttestation,
}: {
  index: number;
  logCount: number;
  timestamp: bigint;
  action: number;
  amountIn: bigint;
  amountOut: bigint;
  tvlAfter: bigint;
  proofHash: string;
  teeAttestation: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const tsMs = Number(timestamp) * 1000;
  const { data: detail, isLoading: detailLoading } = useAuditDetail(expanded ? tsMs : null);

  const date = new Date(tsMs);
  const actionLabel = ACTION_LABELS[action] ?? "Unknown";
  const variant = ACTION_VARIANTS[action] ?? "default";

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Badge variant={variant as "default" | "success" | "destructive"}>
              {actionLabel}
            </Badge>
            <span className="text-lg font-semibold">
              {action === 2
                ? `${(Number(amountIn) / 1e18).toFixed(4)} WETH`
                : `$${formatUSDC(amountIn)}`}
            </span>
            <span className="text-xs text-white/40">
              → {action === 2 ? `$${formatUSDC(amountOut)}` : `${(Number(amountOut) / 1e18).toFixed(4)} WETH`}
            </span>
          </div>
          <span className="text-sm text-white/40">{date.toLocaleString()}</span>
        </div>
        <div className="text-xs text-white/40 mb-3">TVL after: ${formatUSDC(tvlAfter)}</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-white/40 text-xs mb-1">Proof Hash</p>
            <p className="font-mono text-xs text-white/70 break-all">{proofHash}</p>
          </div>
          <div>
            <p className="text-white/40 text-xs mb-1">TEE Attestation</p>
            <p className="font-mono text-xs text-white/70 break-all">{teeAttestation}</p>
          </div>
        </div>

        {/* Expandable 0G Storage details */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <Brain className="h-3 w-3" />
          {expanded ? "Hide" : "View"} TEE reasoning
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {expanded && (
          <div className="mt-3 p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
            {detailLoading ? (
              <p className="text-xs text-white/40">Loading from 0G Storage...</p>
            ) : detail && detail.reasoning ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-emerald-400 font-medium">Sealed Inference — TEE Verified</span>
                </div>
                <div>
                  <p className="text-white/40 text-xs mb-1">Agent Reasoning</p>
                  <p className="text-sm text-white/80">{detail.reasoning}</p>
                </div>
                <div className="flex gap-4">
                  <div>
                    <p className="text-white/40 text-xs mb-1">Confidence</p>
                    <p className="text-sm font-semibold text-white/80">{detail.confidence}%</p>
                  </div>
                  {detail.txHash && (
                    <div>
                      <p className="text-white/40 text-xs mb-1">Vault TX</p>
                      <a
                        href={`https://chainscan-galileo.0g.ai/tx/${detail.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-emerald-400 hover:underline font-mono"
                      >
                        {detail.txHash.slice(0, 10)}...
                      </a>
                    </div>
                  )}
                  {detail.storageTxHash && (
                    <div>
                      <p className="text-white/40 text-xs mb-1">0G Storage TX</p>
                      <a
                        href={`https://chainscan-galileo.0g.ai/tx/${detail.storageTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-emerald-400 hover:underline font-mono"
                      >
                        {detail.storageTxHash.slice(0, 10)}...
                      </a>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-white/40">
                No enriched data found in 0G Storage for this entry.
                This data is available after the agent stores it.
              </p>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-white/30">Log #{logCount - 1 - index}</span>
          <a
            href={`https://chainscan-galileo.0g.ai/address/${TREASURY_VAULT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-400 hover:underline flex items-center gap-1"
          >
            View on Explorer <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AuditPage() {
  const { data: vault, isLoading: vaultLoading } = useParsedVaultData();
  const logCount = vault ? Number(vault.logCount) : 0;

  const logContracts = Array.from({ length: Math.min(logCount, 50) }, (_, i) => ({
    address: TREASURY_VAULT_ADDRESS,
    abi: TREASURY_VAULT_ABI,
    functionName: "executionLogs" as const,
    args: [BigInt(logCount - 1 - i)] as const,
  }));

  const { data: logs } = useReadContracts({
    contracts: logContracts,
    query: { enabled: logCount > 0 },
  });

  if (vaultLoading) {
    return (
      <div className="space-y-6">
        <div><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-72 mt-2" /></div>
        {[...Array(3)].map((_, i) => (
          <Card key={i}><CardContent className="pt-6"><Skeleton className="h-6 w-32 mb-4" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full mt-2" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Trail</h1>
        <p className="text-white/50 text-sm">
          Every agent decision with proof hash, TEE attestation, and reasoning from 0G Storage
        </p>
      </div>

      {logCount === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <FileText className="h-12 w-12 text-white/20 mb-4" />
            <p className="text-white/50">No executions yet. The agent will log decisions here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {logs?.map((log, i) => {
            if (!log.result) return null;
            const [timestamp, action, amountIn, amountOut, tvlAfter, proofHash, teeAttestation] =
              log.result as [bigint, number, bigint, bigint, bigint, string, string];
            return (
              <AuditEntry
                key={i}
                index={i}
                logCount={logCount}
                timestamp={timestamp}
                action={action}
                amountIn={amountIn}
                amountOut={amountOut}
                tvlAfter={tvlAfter}
                proofHash={proofHash}
                teeAttestation={teeAttestation}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
