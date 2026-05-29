"use client";

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TRUSTLESS_VAULT, EARLY_ACCESS_URL } from "@/config/contracts";
import { cn } from "@/lib/utils";

const T = TRUSTLESS_VAULT;

function ProofRow({ label, value, href }: { label: string; value: string; href: string }) {
  const short = value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center justify-between gap-4 px-5 h-12 hover:bg-bg-elev/40 transition-colors"
    >
      <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">{label}</span>
      <span className="flex items-center gap-2 font-mono text-[12px] text-amber tabular">
        {short}
        <ExternalLink className="h-3 w-3 text-ink-faint group-hover:text-amber transition-colors" />
      </span>
    </a>
  );
}

function Pillar({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-hairline bg-bg-elev/20 p-5">
      <h3 className="font-mono text-[10px] uppercase tracking-kicker text-ink mb-3">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Point({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[11px] text-ink-dim leading-relaxed">· {children}</p>;
}

export function TrustlessVaultPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-8">
      {/* Status + identity */}
      <div className="border-l-2 border-phosphor/60 pl-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">Genesis Canary · V2</Badge>
          <Badge variant="success">Proof vault</Badge>
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-kicker text-phosphor">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-phosphor animate-pulse-dot" />
            {T.status}
          </span>
        </div>
        <h2 className="font-serif text-4xl text-ink leading-tight">Trustless Oracle Vault</h2>
        <p className="font-serif italic text-xl text-amber leading-snug">
          You pay for execution assurance.
        </p>
        <p className="text-[13px] text-ink-dim leading-relaxed max-w-2xl">
          Higher-assurance vault path. Fresh Pyth market data is verified on-chain inside the
          execution transaction before policy checks and swap execution.
        </p>
        <p className="font-mono text-[10px] text-ink-faint leading-relaxed max-w-2xl">
          V2 executions may cost more gas due to pull-oracle updates.
        </p>
      </div>

      {/* Two pillars: trust model + economics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Pillar title="Trust model">
          <Point>Pyth pull oracle verified on-chain in the same transaction.</Point>
          <Point>Confidence-interval and staleness bounds enforced by the contract.</Point>
          <Point>Sealed TEE reasoning (private strategy, verifiable proof).</Point>
          <Point>On-chain policy bounds + owner kill-switch.</Point>
        </Pillar>
        <Pillar title="Economics">
          <Point>
            Oracle fee ≈ <span className="text-ink">{T.oracleFeeOg} OG</span> per execution
            (pull-based, paid on-chain).
          </Point>
          <Point>
            Recommended minimum treasury{" "}
            <span className="text-ink">≥ ${T.recommendedMinTreasuryUsd.toLocaleString()}</span>.
          </Point>
          <Point>
            Lower-frequency, higher-value execution — not micro-vault retail.
          </Point>
        </Pillar>
      </div>

      {/* On-chain proof */}
      <div className="border border-hairline">
        <div className="px-5 h-10 flex items-center justify-between border-b border-hairline bg-bg-elev/20">
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink">
            On-chain proof · 0G mainnet
          </span>
          <span className="font-mono text-[9px] uppercase tracking-kicker text-phosphor">verifiable</span>
        </div>
        <div className="divide-y divide-hairline">
          <ProofRow label="VaultFactoryV2" value={T.factory} href={`${T.explorer}/address/${T.factory}`} />
          <ProofRow label="Canary vault" value={T.canaryVault} href={`${T.explorer}/address/${T.canaryVault}`} />
          <ProofRow label="Canonical execution" value={T.executionTx} href={`${T.explorer}/tx/${T.executionTx}`} />
          <ProofRow label="Pyth oracle" value={T.pyth} href={`${T.explorer}/address/${T.pyth}`} />
          <div className="flex items-center justify-between gap-4 px-5 h-12">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
              Price feed
            </span>
            <span className="font-mono text-[12px] text-ink-dim tabular">
              {T.pythFeedLabel}{" "}
              <span className="text-ink-faint">
                {T.pythFeedId.slice(0, 10)}…{T.pythFeedId.slice(-4)}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Honest status note */}
      <p className="font-mono text-[11px] text-ink-faint leading-relaxed border border-hairline bg-bg-elev/10 px-5 py-4">
        Genesis Canary — deployed and verified on 0G mainnet as a proof vault. Official V2 launch
        waits for a new execution with durable, recoverable audit reasoning. Standard vaults are unaffected.
      </p>

      {/* CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim hover:text-amber transition-colors self-start"
        >
          ← Vault type
        </button>
        <a href={EARLY_ACCESS_URL} target="_blank" rel="noopener noreferrer">
          <Button className={cn("min-w-[200px]")}>Request Beta Access</Button>
        </a>
      </div>
    </div>
  );
}
