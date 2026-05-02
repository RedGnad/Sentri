"use client";

import Link from "next/link";
import { useParsedVaultData } from "@/hooks/use-vault";
import { formatUSDC, shortenAddress, bpsToPercent } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Compact card showing one vault's live state. Used in /vaults directory and
 * /my dashboard. Reads chain directly via wagmi hook.
 */
export function VaultCard({ address }: { address: `0x${string}` }) {
  const { data: vault, isLoading } = useParsedVaultData(address);

  if (isLoading || !vault) {
    return (
      <div className="border border-hairline bg-bg-elev/20 p-5">
        <Skeleton className="h-5 w-32 mb-3" />
        <Skeleton className="h-8 w-40 mb-3" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  const status = vault.isKilled ? "killed" : vault.isPaused ? "paused" : "active";
  const allocPct = vault.policy ? bpsToPercent(vault.policy.maxAllocationBps) : "—";

  return (
    <Link
      href={`/v/${address}`}
      className="border border-hairline bg-bg-elev/20 p-5 block hover:border-amber/60 hover:bg-bg-elev/40 transition-colors group"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
          {shortenAddress(address)}
        </span>
        <StatusDot status={status} />
      </div>
      <div className="font-serif text-3xl text-ink tabular leading-none">
        ${formatUSDC(vault.totalValue)}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mt-1">
        TVL
      </div>
      <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-hairline">
        <Field label="Owner" value={shortenAddress(vault.owner)} />
        <Field label="Max alloc" value={`${allocPct}%`} />
        <Field label="Executions" value={String(vault.logCount)} />
      </div>
      <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mt-4 group-hover:text-amber transition-colors">
        View vault →
      </div>
    </Link>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1">
        {label}
      </div>
      <div className="font-mono text-[11px] text-ink tabular truncate">{value}</div>
    </div>
  );
}

function StatusDot({ status }: { status: "active" | "paused" | "killed" }) {
  const map = {
    active: { color: "bg-phosphor animate-pulse-dot", text: "text-phosphor", label: "Active" },
    paused: { color: "bg-amber", text: "text-amber", label: "Paused" },
    killed: { color: "bg-alert", text: "text-alert", label: "Killed" },
  } as const;
  const s = map[status];
  return (
    <span className={`font-mono text-[9px] uppercase tracking-kicker flex items-center gap-1.5 ${s.text}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.color}`} />
      {s.label}
    </span>
  );
}
