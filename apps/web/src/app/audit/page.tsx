"use client";

import { useReadContracts } from "wagmi";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TREASURY_VAULT_ADDRESS, TREASURY_VAULT_ABI } from "@/config/contracts";
import { formatUSDC } from "@/lib/utils";
import { FileText, ExternalLink } from "lucide-react";
import { useVaultData } from "@/hooks/use-vault";

const ACTION_LABELS = ["Rebalance", "YieldFarm", "EmergencyDeleverage"] as const;
const ACTION_VARIANTS = ["default", "success", "destructive"] as const;

export default function AuditPage() {
  const { data: vaultData, isLoading: vaultLoading } = useVaultData();
  const logCount = vaultData ? Number((vaultData[2]?.result as bigint) ?? 0n) : 0;

  // Build read calls for all logs
  const logContracts = Array.from({ length: Math.min(logCount, 50) }, (_, i) => ({
    address: TREASURY_VAULT_ADDRESS,
    abi: TREASURY_VAULT_ABI,
    functionName: "executionLogs" as const,
    args: [BigInt(logCount - 1 - i)] as const, // newest first
  }));

  const { data: logs } = useReadContracts({
    contracts: logContracts,
    query: { enabled: logCount > 0 },
  });

  if (vaultLoading) {
    return <div className="text-center py-20 text-white/50">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Trail</h1>
        <p className="text-white/50 text-sm">
          Every agent decision with proof hash and TEE attestation
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
            const [timestamp, action, amount, proofHash, teeAttestation] = log.result as [
              bigint, number, bigint, string, string,
            ];
            const date = new Date(Number(timestamp) * 1000);
            const actionLabel = ACTION_LABELS[action] ?? "Unknown";
            const variant = ACTION_VARIANTS[action] ?? "default";

            return (
              <Card key={i}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Badge variant={variant as "default" | "success" | "destructive"}>
                        {actionLabel}
                      </Badge>
                      <span className="text-lg font-semibold">
                        ${formatUSDC(amount)}
                      </span>
                    </div>
                    <span className="text-sm text-white/40">
                      {date.toLocaleString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-white/40 text-xs mb-1">Proof Hash</p>
                      <p className="font-mono text-xs text-white/70 break-all">
                        {proofHash}
                      </p>
                    </div>
                    <div>
                      <p className="text-white/40 text-xs mb-1">TEE Attestation</p>
                      <p className="font-mono text-xs text-white/70 break-all">
                        {teeAttestation}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-white/30">
                      Log #{logCount - 1 - i}
                    </span>
                    <a
                      href={`https://chainscan-galileo.0g.ai`}
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
          })}
        </div>
      )}
    </div>
  );
}
