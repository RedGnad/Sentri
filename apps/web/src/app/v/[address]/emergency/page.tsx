"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatUSDC, shortenAddress } from "@/lib/utils";
import { useParsedVaultData, useEmergencyWithdraw, usePause, useUnpause } from "@/hooks/use-vault";
import { Skeleton } from "@/components/ui/skeleton";

export default function VaultEmergencyPage() {
  const params = useParams<{ address: string }>();
  const address = params.address as `0x${string}`;
  const { address: connected } = useAccount();

  const { data: vault, isLoading } = useParsedVaultData(address);
  const { emergencyWithdraw, isPending: isKilling, isSuccess: killSuccess, error: killError } = useEmergencyWithdraw();
  const { pause, isPending: isPausing, isSuccess: pauseSuccess, error: pauseError } = usePause();
  const { unpause, isPending: isUnpausing, isSuccess: unpauseSuccess, error: unpauseError } = useUnpause();

  const [confirmKill, setConfirmKill] = useState(false);

  useEffect(() => { if (pauseSuccess) toast.success("Vault paused"); }, [pauseSuccess]);
  useEffect(() => { if (pauseError) toast.error(`Pause failed: ${pauseError.message}`); }, [pauseError]);
  useEffect(() => { if (unpauseSuccess) toast.success("Vault unpaused"); }, [unpauseSuccess]);
  useEffect(() => { if (unpauseError) toast.error(`Unpause failed: ${unpauseError.message}`); }, [unpauseError]);
  useEffect(() => {
    if (killSuccess) {
      toast.error("Vault permanently killed. All funds withdrawn to owner.");
      setConfirmKill(false);
    }
  }, [killSuccess]);
  useEffect(() => { if (killError) toast.error(`Kill-switch failed: ${killError.message}`); }, [killError]);

  if (isLoading || !vault) {
    return <Skeleton className="h-96 w-full" />;
  }

  const isOwner = connected?.toLowerCase() === vault.owner.toLowerCase();
  const status = vault.isKilled ? "killed" : vault.isPaused ? "paused" : "active";

  return (
    <div className="space-y-8 max-w-3xl">
      <section className="border border-hairline bg-bg-elev/30">
        <div className="flex items-center justify-between px-5 h-9 border-b border-hairline">
          <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">vault.state</span>
          <StatusPill status={status} />
        </div>
        <Row label="Vault Balance" value={`$${formatUSDC(vault.balance)} USDC`} />
        <Row label="Owner" value={shortenAddress(vault.owner)} mono />
        <Row label="You are" value={isOwner ? "Owner" : "Visitor"} valueClass={isOwner ? "text-amber" : "text-ink-dim"} />
      </section>

      <section className="border border-hairline">
        <header className="flex items-center justify-between px-5 h-9 border-b border-hairline">
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">§ A · Soft halt</span>
          <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">reversible</span>
        </header>
        <div className="px-5 py-5 space-y-4">
          <p className="text-[13px] text-ink-dim leading-relaxed">
            {vault.isPaused
              ? "Vault is currently paused. Deposits, withdrawals, and agent executions are all blocked. Unpause to resume normal operation."
              : "Pausing the vault temporarily blocks all deposits, withdrawals, and agent executions. Funds remain in place."}
          </p>
          {vault.isPaused ? (
            <Button className="w-full" onClick={() => unpause(address)} disabled={!isOwner || isUnpausing || vault.isKilled}>
              {isUnpausing ? "Unpausing..." : "Unpause Vault →"}
            </Button>
          ) : (
            <Button className="w-full" variant="outline" onClick={() => pause(address)} disabled={!isOwner || isPausing || vault.isKilled}>
              {isPausing ? "Pausing..." : "Pause Vault"}
            </Button>
          )}
        </div>
      </section>

      <section className="border border-alert/40">
        <header className="flex items-center justify-between px-5 h-9 border-b border-alert/40 bg-alert/[0.04]">
          <span className="font-mono text-[10px] uppercase tracking-kicker text-alert">§ B · Hard kill</span>
          <span className="font-mono text-[9px] uppercase tracking-kicker text-alert">irreversible</span>
        </header>
        <div className="px-5 py-5 space-y-4">
          <p className="font-serif italic text-lg text-ink leading-snug">
            Withdraw <span className="text-amber tabular">${formatUSDC(vault.balance)}</span> to the owner and disable the vault forever.
          </p>
          <p className="text-[13px] text-ink-dim leading-relaxed">
            The kill-switch is the ultimate guarantee. Once activated, the vault rejects all future executions, including yours.
          </p>

          {vault.isKilled ? (
            <div className="border border-alert/30 px-4 py-3 bg-alert/[0.04] font-mono text-[10px] uppercase tracking-kicker text-alert text-center">
              ∎ Vault permanently killed
            </div>
          ) : !confirmKill ? (
            <Button className="w-full" variant="destructive" onClick={() => setConfirmKill(true)} disabled={!isOwner}>
              Activate Kill-Switch
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="border border-alert/40 px-4 py-3 bg-alert/[0.04] font-mono text-[11px] text-alert leading-relaxed">
                {"> "}This will withdraw <span className="tabular">${formatUSDC(vault.balance)}</span> USDC to the owner and permanently disable the vault.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" onClick={() => setConfirmKill(false)}>Cancel</Button>
                <Button variant="destructive" onClick={() => emergencyWithdraw(address)} disabled={isKilling}>
                  {isKilling ? "Executing..." : "Confirm Kill ∎"}
                </Button>
              </div>
            </div>
          )}

          {!isOwner && (
            <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint text-center pt-2">
              Owner-only action
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Row({ label, value, mono = false, valueClass = "text-ink" }: { label: string; value: string; mono?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between px-5 h-11 border-b border-hairline last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">{label}</span>
      <span className={`text-[13px] tabular ${mono ? "font-mono text-[11px]" : ""} ${valueClass}`}>{value}</span>
    </div>
  );
}

function StatusPill({ status }: { status: "active" | "paused" | "killed" }) {
  if (status === "killed") return <span className="font-mono text-[10px] uppercase tracking-kicker text-alert flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-alert" />Killed</span>;
  if (status === "paused") return <span className="font-mono text-[10px] uppercase tracking-kicker text-amber flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber" />Paused</span>;
  return <span className="font-mono text-[10px] uppercase tracking-kicker text-phosphor flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-phosphor animate-pulse-dot" />Active</span>;
}
