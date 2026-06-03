"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useVaultsByOwner, useLegacyVaultsByOwner, useV2VaultsByOwner, useLegacyV2VaultsByOwner } from "@/hooks/use-factory";
import { VaultCard } from "@/components/vault-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function MyVaultsPage() {
  const { address } = useAccount();
  const { data: vaultsRaw, isLoading } = useVaultsByOwner(address);
  const { data: legacyRaw } = useLegacyVaultsByOwner(address);
  const { data: v2Raw } = useV2VaultsByOwner(address);
  const { data: legacyV2Raw } = useLegacyV2VaultsByOwner(address);
  const vaults = (vaultsRaw as readonly `0x${string}`[] | undefined) ?? [];
  const legacyVaults = (legacyRaw as readonly `0x${string}`[] | undefined) ?? [];
  const v2Vaults = (v2Raw as readonly `0x${string}`[] | undefined) ?? [];
  const legacyV2Vaults = (legacyV2Raw as readonly `0x${string}`[] | undefined) ?? [];
  const allLegacy = [...legacyVaults.map(a => ({ address: a, tier: "standard" as const })), ...legacyV2Vaults.map(a => ({ address: a, tier: "v2" as const }))];
  const total = vaults.length + v2Vaults.length + allLegacy.length;

  return (
    <div className="space-y-10">
      <PageHeader
        num="03"
        section="My Vaults"
        title="Yours"
        subtitle={
          !address
            ? "Connect a wallet to see vaults you own."
            : `${total} vault${total === 1 ? "" : "s"} owned by ${address.slice(0, 6)}…${address.slice(-4)}`
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
      ) : total === 0 ? (
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
        <div className="space-y-10">
          {(vaults.length > 0 || v2Vaults.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {vaults.map((addr) => <VaultCard key={addr} address={addr} tier="standard" />)}
              {v2Vaults.map((addr) => <VaultCard key={addr} address={addr} tier="v2" />)}
            </div>
          )}
          {allLegacy.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
                  Legacy — previous contract version
                </span>
                <div className="flex-1 border-t border-hairline" />
              </div>
              <p className="font-mono text-[10px] text-ink-faint">
                These vaults run on an older implementation. Access the vault page to emergency withdraw.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {allLegacy.map(({ address, tier }) => (
                  <VaultCard key={address} address={address} tier={tier} isLegacy />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
