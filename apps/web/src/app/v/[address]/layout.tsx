"use client";

import { isAddress } from "viem";
import { useParsedVaultData } from "@/hooks/use-vault";
import { useAccount } from "wagmi";
import { formatUSDC, shortenAddress } from "@/lib/utils";
import { VaultTabs } from "@/components/vault-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function VaultLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { address: string };
}) {
  const { address: rawAddress } = params;

  if (!isAddress(rawAddress)) {
    return (
      <div className="border border-alert/40 bg-alert/[0.04] p-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-kicker text-alert">
          Invalid vault address: {rawAddress}
        </p>
        <Link href="/vaults" className="font-mono text-[10px] uppercase tracking-kicker text-amber mt-4 inline-block">
          ← Back to directory
        </Link>
      </div>
    );
  }

  const address = rawAddress as `0x${string}`;
  return <VaultLayoutInner address={address}>{children}</VaultLayoutInner>;
}

function VaultLayoutInner({
  address,
  children,
}: {
  address: `0x${string}`;
  children: React.ReactNode;
}) {
  const { data: vault, isLoading } = useParsedVaultData(address);
  const { address: connected } = useAccount();
  const isOwner = connected && vault && connected.toLowerCase() === vault.owner.toLowerCase();

  return (
    <div className="space-y-8">
      {/* Vault header */}
      <header className="border-b border-hairline pb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint flex items-center gap-3">
            <Link href="/vaults" className="hover:text-amber transition-colors">
              ← Vaults
            </Link>
            <span>·</span>
            <span className="tabular">{shortenAddress(address)}</span>
          </div>
          {isLoading || !vault ? null : (
            <div className="flex items-center gap-2">
              {vault.isKilled && <Badge variant="destructive"><span className="inline-block w-1.5 h-1.5 rounded-full bg-alert mr-1.5" />Killed</Badge>}
              {vault.isPaused && !vault.isKilled && <Badge variant="warning"><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber mr-1.5" />Paused</Badge>}
              {!vault.isPaused && !vault.isKilled && <Badge variant="success"><span className="inline-block w-1.5 h-1.5 rounded-full bg-phosphor animate-pulse-dot mr-1.5" />Active</Badge>}
              {isOwner && <Badge variant="default">Owner</Badge>}
            </div>
          )}
        </div>
        <h1 className="font-serif text-5xl sm:text-6xl text-ink tracking-tightest leading-none">
          Vault
        </h1>
        {isLoading || !vault ? (
          <Skeleton className="h-5 w-64 mt-3" />
        ) : (
          <p className="font-serif italic text-lg text-ink-dim mt-3">
            ${formatUSDC(vault.totalValue)} TVL · owned by {shortenAddress(vault.owner)} ·{" "}
            {String(vault.logCount)} executions
          </p>
        )}
      </header>

      <VaultTabs address={address} />

      {children}
    </div>
  );
}
