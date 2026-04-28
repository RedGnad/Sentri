"use client";

import { useState } from "react";
import { useReadContracts } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { TREASURY_VAULT_ADDRESS, TREASURY_VAULT_ABI } from "@/config/contracts";
import { formatUSDC } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useParsedVaultData } from "@/hooks/use-vault";
import { useAuditDetail } from "@/hooks/use-agent-status";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

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
  const logId = String(logCount - 1 - index).padStart(4, "0");

  return (
    <article className="border border-hairline bg-bg-elev/20 hover:bg-bg-elev/40 transition-colors">
      {/* Header strip */}
      <header className="flex items-center justify-between px-5 h-10 border-b border-hairline">
        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] text-ink-faint tabular">
            log/{logId}
          </span>
          <Badge variant={variant as "default" | "success" | "destructive"}>{actionLabel}</Badge>
        </div>
        <span className="font-mono text-[10px] text-ink-faint tabular">
          {date.toISOString().slice(0, 19).replace("T", " ")} UTC
        </span>
      </header>

      <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-3 gap-5">
        <Field label="Amount in">
          <span className="font-serif text-2xl text-ink tabular">
            {action === 2
              ? `${(Number(amountIn) / 1e18).toFixed(4)}`
              : `$${formatUSDC(amountIn)}`}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint ml-1.5">
            {action === 2 ? "WETH" : "USDC"}
          </span>
        </Field>

        <Field label="Amount out">
          <span className="font-serif text-2xl text-amber tabular">
            {action === 2 ? `$${formatUSDC(amountOut)}` : `${(Number(amountOut) / 1e18).toFixed(4)}`}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint ml-1.5">
            {action === 2 ? "USDC" : "WETH"}
          </span>
        </Field>

        <Field label="TVL after">
          <span className="font-serif text-2xl text-ink tabular">
            ${formatUSDC(tvlAfter)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint ml-1.5">
            USDC
          </span>
        </Field>
      </div>

      {/* Proof + attestation */}
      <div className="grid grid-cols-1 md:grid-cols-2 border-t border-hairline">
        <div className="px-5 py-4 md:border-r border-hairline">
          <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
            Proof hash
          </div>
          <code className="font-mono text-[11px] text-ink-dim break-all">{proofHash}</code>
        </div>
        <div className="px-5 py-4 border-t md:border-t-0 border-hairline">
          <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
            TEE attestation
          </div>
          <code className="font-mono text-[11px] text-ink-dim break-all">{teeAttestation}</code>
        </div>
      </div>

      {/* Expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 h-10 border-t border-hairline font-mono text-[10px] uppercase tracking-kicker text-ink-dim hover:text-amber transition-colors group"
      >
        <span className="flex items-center gap-2">
          ∎ {expanded ? "Hide" : "Reveal"} TEE reasoning
        </span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {expanded && (
        <div className="border-t border-hairline px-5 py-5 bg-bg-sunk/40">
          {detailLoading ? (
            <p className="font-mono text-[11px] text-ink-faint">Loading from 0G Storage...</p>
          ) : detail && detail.reasoning ? (
            <div className="space-y-5">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-kicker text-phosphor">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-phosphor animate-pulse-dot" />
                Sealed Inference · TEE Verified
              </div>

              <div>
                <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-2">
                  Agent reasoning
                </div>
                <p className="font-serif italic text-[16px] text-ink leading-relaxed">
                  &ldquo;{detail.reasoning}&rdquo;
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 border-t border-hairline pt-4">
                <Field label="Confidence">
                  <span className="font-serif text-2xl text-amber tabular">{detail.confidence}%</span>
                </Field>
                {detail.txHash && (
                  <Field label="Vault TX">
                    <a
                      href={`https://chainscan-galileo.0g.ai/tx/${detail.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[12px] text-amber hover:underline tabular flex items-center gap-1"
                    >
                      {detail.txHash.slice(0, 10)}…
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Field>
                )}
                {detail.storageTxHash && (
                  <Field label="0G Storage TX">
                    <a
                      href={`https://chainscan-galileo.0g.ai/tx/${detail.storageTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[12px] text-amber hover:underline tabular flex items-center gap-1"
                    >
                      {detail.storageTxHash.slice(0, 10)}…
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Field>
                )}
              </div>
            </div>
          ) : (
            <p className="font-mono text-[11px] text-ink-faint leading-relaxed">
              ∅ No enriched data found in 0G Storage for this entry. The agent
              writes reasoning asynchronously after each on-chain execution.
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-hairline px-5 h-9 flex items-center justify-end">
        <a
          href={`https://chainscan-galileo.0g.ai/address/${TREASURY_VAULT_ADDRESS}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint hover:text-amber transition-colors flex items-center gap-1.5"
        >
          View on explorer <ExternalLink className="h-3 w-3" />
        </a>
      </footer>
    </article>
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
        <Skeleton className="h-12 w-64" />
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <PageHeader
        num="02"
        section="Audit"
        title="Trail"
        subtitle={`${logCount} executions · proof hash + TEE attestation per decision`}
      />

      {logCount === 0 ? (
        <div className="border border-hairline bg-bg-elev/20 py-20 text-center">
          <div className="font-serif italic text-xl text-ink-dim mb-2">
            No executions yet.
          </div>
          <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
            The agent will append decisions here as it operates.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
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

function PageHeader({
  num,
  section,
  title,
  subtitle,
}: {
  num: string;
  section: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="border-b border-hairline pb-6">
      <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mb-3">
        § {num} · {section}
      </div>
      <h1 className="font-serif text-5xl sm:text-6xl text-ink tracking-tightest leading-none">
        {title}
      </h1>
      <p className="font-serif italic text-lg text-ink-dim mt-3">{subtitle}</p>
    </header>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
