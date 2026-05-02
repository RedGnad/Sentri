"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useVaultsByOwner } from "@/hooks/use-factory";
import { VaultCard } from "@/components/vault-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function MyVaultsPage() {
  const { address } = useAccount();
  const { data: vaultsRaw, isLoading } = useVaultsByOwner(address);
  const vaults = (vaultsRaw as readonly `0x${string}`[] | undefined) ?? [];

  return (
    <div className="space-y-10">
      <PageHeader
        num="03"
        section="My Vaults"
        title="Yours"
        subtitle={
          !address
            ? "Connect a wallet to see vaults you own."
            : `${vaults.length} vault${vaults.length === 1 ? "" : "s"} owned by ${address.slice(0, 6)}…${address.slice(-4)}`
        }
        right={
          <Link href="/deploy">
            <Button>Deploy a vault →</Button>
          </Link>
        }
      />

      {!address ? (
        <div className="border border-hairline bg-bg-elev/20 py-20 text-center">
          <p className="font-serif italic text-xl text-ink-dim mb-2">Wallet not connected.</p>
          <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
            Use the Connect button in the header.
          </p>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
      ) : vaults.length === 0 ? (
        <div className="border border-hairline bg-bg-elev/20 py-20 text-center">
          <p className="font-serif italic text-xl text-ink-dim mb-2">No vaults owned by this wallet yet.</p>
          <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mb-6">
            Deploy your first to get the agent running on your reserves.
          </p>
          <Link href="/deploy">
            <Button>Deploy a vault →</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vaults.map((addr) => <VaultCard key={addr} address={addr} />)}
        </div>
      )}
    </div>
  );
}
