"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useParsedVaultData, useSetPolicy } from "@/hooks/use-vault";
import { bpsToPercent } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { RISK_SYMBOL } from "@/config/contracts";

export default function VaultPolicyPage() {
  const params = useParams<{ address: string }>();
  const address = params.address as `0x${string}`;
  const { address: connected } = useAccount();

  const { data: vault, isLoading } = useParsedVaultData(address);
  const { setPolicy, isPending, isConfirming, isSuccess, error } = useSetPolicy();

  const [maxAllocation, setMaxAllocation] = useState("");
  const [maxDrawdown, setMaxDrawdown] = useState("");
  const [rebalanceThreshold, setRebalanceThreshold] = useState("");
  const [maxSlippage, setMaxSlippage] = useState("");
  const [cooldownPeriod, setCooldownPeriod] = useState("");
  const [maxPriceStaleness, setMaxPriceStaleness] = useState("");

  const isOwner = connected?.toLowerCase() === (vault?.owner ?? "").toLowerCase();

  useEffect(() => {
    if (vault?.policy) {
      setMaxAllocation(bpsToPercent(vault.policy.maxAllocationBps));
      setMaxDrawdown(bpsToPercent(vault.policy.maxDrawdownBps));
      setRebalanceThreshold(bpsToPercent(vault.policy.rebalanceThresholdBps));
      setMaxSlippage(bpsToPercent(vault.policy.maxSlippageBps));
      setCooldownPeriod(vault.policy.cooldownPeriod.toString());
      setMaxPriceStaleness(vault.policy.maxPriceStaleness.toString());
    }
  }, [vault?.policy]);

  useEffect(() => { if (isSuccess) toast.success("Policy updated on-chain"); }, [isSuccess]);
  useEffect(() => { if (error) toast.error(`Policy update failed: ${error.message}`); }, [error]);

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPolicy(address, {
      maxAllocationBps: Math.round(Number(maxAllocation) * 100),
      maxDrawdownBps: Math.round(Number(maxDrawdown) * 100),
      rebalanceThresholdBps: Math.round(Number(rebalanceThreshold) * 100),
      maxSlippageBps: Math.round(Number(maxSlippage) * 100),
      cooldownPeriod: Number(cooldownPeriod),
      maxPriceStaleness: Number(maxPriceStaleness),
    });
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <p className="font-serif italic text-xl text-ink-dim leading-snug border-l-2 border-amber pl-5">
        The agent proposes. The policy disposes. Every parameter below is enforced
        by the vault contract — not by trust.
      </p>

      {vault?.policy && (
        <section className="border border-hairline bg-bg-elev/30">
          <header className="flex items-center justify-between px-5 h-9 border-b border-hairline">
            <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">Current policy</span>
            <span className="font-mono text-[9px] uppercase tracking-kicker text-phosphor flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-phosphor animate-pulse-dot" />
              Live
            </span>
          </header>
          <ul className="divide-y divide-hairline">
            <PolicyRow label={`Max ${RISK_SYMBOL} exposure`} value={`${bpsToPercent(vault.policy.maxAllocationBps)} %`} hint="Post-trade share of TVL" />
            <PolicyRow label="Max drawdown from HWM" value={`${bpsToPercent(vault.policy.maxDrawdownBps)} %`} hint="Strategy frozen above this" />
            <PolicyRow label="Rebalance threshold" value={`${bpsToPercent(vault.policy.rebalanceThresholdBps)} %`} hint="Min deviation to act" />
            <PolicyRow label="Max slippage" value={`${bpsToPercent(vault.policy.maxSlippageBps)} %`} hint="Per swap, vs oracle" />
            <PolicyRow label="Min action spacing" value={`${vault.policy.cooldownPeriod} s`} hint="Vault-level cadence guard" />
            <PolicyRow label="Max price staleness" value={`${vault.policy.maxPriceStaleness} s`} hint="Oracle freshness window" />
          </ul>
        </section>
      )}

      <section className="border border-hairline">
        <header className="flex items-center justify-between px-5 h-9 border-b border-hairline">
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">Update policy</span>
          <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
            {isOwner ? "Owner authorized" : "Owner only"}
          </span>
        </header>
        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5">
          <FormField label={`Max ${RISK_SYMBOL} exposure`} unit="%" value={maxAllocation} onChange={setMaxAllocation} disabled={!isOwner} step="0.1" min="0.1" max="50" />
          <FormField label="Max drawdown from HWM" unit="%" value={maxDrawdown} onChange={setMaxDrawdown} disabled={!isOwner} step="0.1" min="0.1" max="20" />
          <FormField label="Rebalance threshold" unit="%" value={rebalanceThreshold} onChange={setRebalanceThreshold} disabled={!isOwner} step="0.1" min="0" max="50" />
          <FormField label="Max slippage" unit="%" value={maxSlippage} onChange={setMaxSlippage} disabled={!isOwner} step="0.1" min="0.1" max="5" />
          <FormField label="Min action spacing" unit="s" value={cooldownPeriod} onChange={setCooldownPeriod} disabled={!isOwner} min="60" />
          <FormField label="Max price staleness" unit="s" value={maxPriceStaleness} onChange={setMaxPriceStaleness} disabled={!isOwner} min="30" max="600" />
          <Button type="submit" className="w-full" disabled={!isOwner || isPending || isConfirming}>
            {isPending ? "Confirm in wallet..." : isConfirming ? "Waiting for TX..." : "Commit Policy → Chain"}
          </Button>
          <p className="font-mono text-[10px] text-ink-faint leading-relaxed border-t border-hairline pt-3">
            ∎ Changes take effect immediately on confirmation. The agent reads policy on every execution — there is no cache to invalidate.
          </p>
        </form>
      </section>
    </div>
  );
}

function PolicyRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <li className="grid grid-cols-[1.6fr_auto_1fr] items-center px-5 h-12 gap-4 hover:bg-bg-elev/40 transition-colors">
      <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">{label}</span>
      <span className="font-mono text-[14px] text-amber tabular tracking-tight">{value}</span>
      <span className="font-mono text-[10px] text-ink-faint hidden sm:inline text-right">{hint}</span>
    </li>
  );
}

function FormField({
  label,
  unit,
  value,
  onChange,
  disabled,
  step,
  min,
  max,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  step?: string;
  min?: string;
  max?: string;
}) {
  return (
    <div>
      <label className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint block mb-2">
        {label} <span className="text-ink-mute">[{unit}]</span>
      </label>
      <Input type="number" step={step} min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </div>
  );
}
