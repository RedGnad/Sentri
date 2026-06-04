"use client";

import Link from "next/link";
import { useActiveVaultsPage, useLegacyVaults, useLegacyV2Vaults, useNonEmptyLegacyVaults } from "@/hooks/use-factory";
import { VaultCard } from "@/components/vault-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function VaultsPage() {
  const { data: vaults, isLoading } = useActiveVaultsPage(0n);
  const legacyVaults = useLegacyVaults();
  const legacyV2Vaults = useLegacyV2Vaults();
  const allLegacyRaw = [...legacyVaults.map(a => ({ address: a, tier: "standard" as const })), ...legacyV2Vaults.map(a => ({ address: a, tier: "v2" as const }))];
  // Public directory hides drained legacy vaults; owners still see them in My Vaults.
  const allLegacy = useNonEmptyLegacyVaults(allLegacyRaw);

  const total = vaults.length;

  return (
    <div className="space-y-10">
      <PageHeader
        num="01"
        section="Vaults"
        title="Directory"
        subtitle={
          isLoading
            ? "Loading vaults…"
            : `${total} vault${total === 1 ? "" : "s"} · public audit readable without a wallet`
        }
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
            {vaults.map((vault) => (
              <VaultCard
                key={`${vault.tier}-${vault.address}`}
                address={vault.address}
                tier={vault.tier}
              />
            ))}
          </div>
        </>
      )}

      {!isLoading && allLegacy.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
              Legacy — previous contract version
            </span>
            <div className="flex-1 border-t border-hairline" />
          </div>
          <p className="font-mono text-[10px] text-ink-faint">
            These vaults run on an older implementation. The agent no longer manages them.
            Owners can access emergency withdrawal from each vault&apos;s page.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {allLegacy.map(({ address, tier }) => (
              <VaultCard key={address} address={address} tier={tier} isLegacy />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
