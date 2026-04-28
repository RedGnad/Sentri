"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatUSDC } from "@/lib/utils";
import { useParsedVaultData, useEmergencyWithdraw, usePause, useUnpause } from "@/hooks/use-vault";
import { Skeleton } from "@/components/ui/skeleton";

export default function EmergencyPage() {
  const { address } = useAccount();
  const { data: vault, isLoading } = useParsedVaultData();
  const { emergencyWithdraw, isPending: isKilling, isSuccess: killSuccess, error: killError } = useEmergencyWithdraw();
  const { pause, isPending: isPausing, isSuccess: pauseSuccess, error: pauseError } = usePause();
  const { unpause, isPending: isUnpausing, isSuccess: unpauseSuccess, error: unpauseError } = useUnpause();

  const [confirmKill, setConfirmKill] = useState(false);

  useEffect(() => { if (pauseSuccess) toast.success("Vault paused — all operations blocked"); }, [pauseSuccess]);
  useEffect(() => { if (pauseError) toast.error(`Pause failed: ${pauseError.message}`); }, [pauseError]);
  useEffect(() => { if (unpauseSuccess) toast.success("Vault unpaused — operations resumed"); }, [unpauseSuccess]);
  useEffect(() => { if (unpauseError) toast.error(`Unpause failed: ${unpauseError.message}`); }, [unpauseError]);
  useEffect(() => {
    if (killSuccess) {
      toast.error("Vault permanently killed. All funds withdrawn to owner.");
      setConfirmKill(false);
    }
  }, [killSuccess]);
  useEffect(() => { if (killError) toast.error(`Kill-switch failed: ${killError.message}`); }, [killError]);

  if (isLoading || !vault) {
    return (
      <div className="space-y-6 max-w-2xl">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const isOwner = address?.toLowerCase() === vault.owner.toLowerCase();
  const status = vault.isKilled ? "killed" : vault.isPaused ? "paused" : "active";

  return (
    <div className="space-y-10 max-w-3xl">
      <PageHeader num="04" section="Emergency" title="Circuit Breaker" subtitle="Pause and kill-switch · owner only" />

      {/* Status panel */}
      <section className="border border-hairline bg-bg-elev/30">
        <div className="flex items-center justify-between px-5 h-9 border-b border-hairline">
          <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">vault.state</span>
          <StatusPill status={status} />
        </div>
        <Row label="Vault Balance" value={`$${formatUSDC(vault.balance)} USDC`} />
        <Row label="Owner" value={vault.owner.slice(0, 6) + "…" + vault.owner.slice(-4)} mono />
        <Row label="You are" value={isOwner ? "Owner" : "Visitor"} valueClass={isOwner ? "text-amber" : "text-ink-dim"} />
      </section>

      {/* Pause / Unpause */}
      <section className="border border-hairline">
        <header className="flex items-center justify-between px-5 h-9 border-b border-hairline">
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">
            § A · Soft halt
          </span>
          <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">reversible</span>
        </header>
        <div className="px-5 py-5 space-y-4">
          <p className="text-[13px] text-ink-dim leading-relaxed">
            {vault.isPaused
              ? "Vault is currently paused. Deposits, withdrawals, and agent executions are all blocked. Unpause to resume normal operation."
              : "Pausing the vault temporarily blocks all deposits, withdrawals, and agent executions. Funds remain in place. Use as a circuit breaker before deciding next steps."}
          </p>
          {vault.isPaused ? (
            <Button
              className="w-full"
              onClick={() => unpause()}
              disabled={!isOwner || isUnpausing || vault.isKilled}
            >
              {isUnpausing ? "Unpausing..." : "Unpause Vault →"}
            </Button>
          ) : (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => pause()}
              disabled={!isOwner || isPausing || vault.isKilled}
            >
              {isPausing ? "Pausing..." : "Pause Vault"}
            </Button>
          )}
        </div>
      </section>

      {/* Kill Switch */}
      <section className="border border-alert/40">
        <header className="flex items-center justify-between px-5 h-9 border-b border-alert/40 bg-alert/[0.04]">
          <span className="font-mono text-[10px] uppercase tracking-kicker text-alert">
            § B · Hard kill
          </span>
          <span className="font-mono text-[9px] uppercase tracking-kicker text-alert">irreversible</span>
        </header>
        <div className="px-5 py-5 space-y-4">
          <p className="font-serif italic text-lg text-ink leading-snug">
            Withdraw <span className="text-amber tabular">${formatUSDC(vault.balance)}</span> to the owner and disable the vault forever.
          </p>
          <p className="text-[13px] text-ink-dim leading-relaxed">
            The kill-switch is the ultimate guarantee. Once activated, the vault rejects all future executions, including yours.
            It is the answer to <em className="font-serif">"what if the agent goes wrong"</em>.
          </p>

          {vault.isKilled ? (
            <div className="border border-alert/30 px-4 py-3 bg-alert/[0.04] font-mono text-[10px] uppercase tracking-kicker text-alert text-center">
              ∎ Vault permanently killed
            </div>
          ) : !confirmKill ? (
            <Button
              className="w-full"
              variant="destructive"
              onClick={() => setConfirmKill(true)}
              disabled={!isOwner}
            >
              Activate Kill-Switch
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="border border-alert/40 px-4 py-3 bg-alert/[0.04] font-mono text-[11px] text-alert leading-relaxed">
                {"> "}This will withdraw{" "}
                <span className="tabular">${formatUSDC(vault.balance)}</span> USDC to the owner and
                permanently disable the vault. Type confirm by clicking below.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" onClick={() => setConfirmKill(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => emergencyWithdraw()}
                  disabled={isKilling}
                >
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

function Row({
  label,
  value,
  mono = false,
  valueClass = "text-ink",
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between px-5 h-11 border-b border-hairline last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">{label}</span>
      <span className={`text-[13px] tabular ${mono ? "font-mono text-[11px]" : ""} ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: "active" | "paused" | "killed" }) {
  if (status === "killed") {
    return (
      <Badge variant="destructive">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-alert mr-1.5" />
        Killed
      </Badge>
    );
  }
  if (status === "paused") {
    return (
      <Badge variant="warning">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber mr-1.5" />
        Paused
      </Badge>
    );
  }
  return (
    <Badge variant="success">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-phosphor animate-pulse-dot mr-1.5" />
      Active
    </Badge>
  );
}
