"use client";

import Link from "next/link";
import { useParsedVaultData, type VaultTier } from "@/hooks/use-vault";
import { TRUSTLESS_VAULT } from "@/config/contracts";
import { formatUSDC, shortenAddress, bpsToPercent, cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

/**
 * Compact card showing one vault's live state. Used in /vaults directory and
 * /my dashboard. Reads chain directly via wagmi hook.
 */
export function VaultCard({
  address,
  tier,
  isLegacy = false,
}: {
  address: `0x${string}`;
  tier?: VaultTier;
  isLegacy?: boolean;
}) {
  const { data: vault, isLoading } = useParsedVaultData(address, tier);

  if (isLoading || !vault) {
    return (
      <div className="border border-hairline bg-bg-elev/20 p-5">
        <Skeleton className="h-5 w-32 mb-3" />
        <Skeleton className="h-8 w-40 mb-3" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  const status = isLegacy ? "legacy" : vault.isKilled ? "killed" : vault.isPaused ? "paused" : "active";
  const allocPct = vault.policy ? bpsToPercent(vault.policy.maxAllocationBps) : "—";
  const isV2 = (tier ?? vault.tier) === "v2";
  const isGenesisCanary =
    isV2 && address.toLowerCase() === TRUSTLESS_VAULT.canaryVault.toLowerCase();

  return (
    <Link
      href={`/v/${address}`}
      className={cn(
        "border bg-bg-elev/20 p-5 block hover:bg-bg-elev/40 transition-colors group",
        isV2
          ? "border-orchid/50 hover:border-orchid/80"
          : "border-hairline hover:border-amber/60",
      )}
    >
      <div className="mb-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint truncate min-w-0">
            {shortenAddress(address)}
          </span>
          <StatusDot status={status} />
        </div>
        <div>
          {isV2 ? (
            <Badge className="border-orchid/50 text-orchid px-1.5 py-0.5 inline-flex">
              {isGenesisCanary ? "Genesis Canary · V2" : "Trustless Oracle · V2"}
            </Badge>
          ) : (
            <Badge className="border-hairline text-ink-faint px-1.5 py-0.5 inline-flex">
              Standard · V1
            </Badge>
          )}
        </div>
      </div>
      <div className="font-serif text-3xl text-ink tabular leading-none">
        {vault.tvlStatus === "estimating"
          ? "TVL estimating"
          : `$${formatUSDC(vault.totalValue)}`}
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

function StatusDot({ status }: { status: "active" | "paused" | "killed" | "legacy" }) {
  const map = {
    active: { color: "bg-phosphor animate-pulse-dot", text: "text-phosphor", label: "Active" },
    paused: { color: "bg-amber", text: "text-amber", label: "Paused" },
    killed: { color: "bg-alert", text: "text-alert", label: "Killed" },
    legacy: { color: "bg-phosphor", text: "text-phosphor", label: "Legacy" },
  } as const;
  const s = map[status];
  return (
    <span className={`font-mono text-[9px] uppercase tracking-kicker flex items-center gap-1.5 ${s.text}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.color}`} />
      {s.label}
    </span>
  );
}
