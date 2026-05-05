"use client";

import Link from "next/link";
import { useVaultsCount, useVaultsPage } from "@/hooks/use-factory";
import { VaultCard } from "@/components/vault-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 24n;

export default function VaultsPage() {
  const { data: countRaw, isLoading: countLoading } = useVaultsCount();
  const total = countRaw !== undefined ? Number(countRaw) : 0;
  const { data: addresses, isLoading: pageLoading } = useVaultsPage(0n, PAGE_SIZE);

  const vaults = (addresses as readonly `0x${string}`[] | undefined) ?? [];
  const isLoading = countLoading || pageLoading;

  return (
    <div className="space-y-10">
      <PageHeader
        num="01"
        section="Vaults"
        title="Directory"
        subtitle={`${total} vault${total === 1 ? "" : "s"} live · all public · audit readable without a wallet`}
        right={
          <Link href="/deploy">
            <Button>Deploy a vault →</Button>
          </Link>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : vaults.length === 0 ? (
        <div className="border border-hairline bg-bg-elev/20 py-20 text-center">
          <p className="font-serif italic text-xl text-ink-dim mb-2">
            No vaults deployed yet.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mb-6">
            Be the first.
          </p>
          <Link href="/deploy">
            <Button>Deploy the first vault →</Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vaults.map((addr) => (
              <VaultCard key={addr} address={addr} />
            ))}
          </div>
          {total > vaults.length && (
            <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint text-center">
              Showing first {vaults.length} of {total}
            </p>
          )}
        </>
      )}
    </div>
  );
}
