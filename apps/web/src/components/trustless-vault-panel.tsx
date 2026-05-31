"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { decodeEventLog } from "viem";
import { Check, Copy, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EARLY_ACCESS_URL,
  PRESET_LABELS,
  PresetTier,
  TRUSTLESS_VAULT,
  VAULT_FACTORY_V2_ABI,
} from "@/config/contracts";
import { useCreateV2Vault } from "@/hooks/use-factory";
import { cn } from "@/lib/utils";

const T = TRUSTLESS_VAULT;
const TELEGRAM_HANDLE = "@RedG_billycatnip";
const TELEGRAM_URL = "https://t.me/RedG_billycatnip";

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

type CreateMode = "idle" | "preset";

export function TrustlessVaultPanel({ onBack }: { onBack: () => void }) {
  const { address: connectedAddress } = useAccount();
  const [createMode, setCreateMode] = useState<CreateMode>("idle");
  const [tier, setTier] = useState<number>(PresetTier.Balanced);
  const [createdVault, setCreatedVault] = useState<`0x${string}` | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    createPreset,
    isPending: isCreating,
    isConfirming: isCreateConfirming,
    isSuccess: createSuccess,
    receipt,
    reset: resetCreate,
  } = useCreateV2Vault();

  // Parse the TrustlessOracleVaultCreated event from the receipt so we can
  // surface the new vault address inline (no redirect) — the user still
  // needs the explainer above to know what to do with that address.
  useEffect(() => {
    if (!createSuccess || !receipt || createdVault) return;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: VAULT_FACTORY_V2_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "TrustlessOracleVaultCreated") {
          const args = decoded.args as { vault: `0x${string}` };
          setCreatedVault(args.vault);
          toast.success(`V2 vault deployed: ${args.vault.slice(0, 10)}…`);
          break;
        }
      } catch {
        // not our event — skip
      }
    }
  }, [createSuccess, receipt, createdVault]);

  function handleCreate() {
    if (!connectedAddress) {
      toast.error("Connect your wallet to deploy a V2 vault.");
      return;
    }
    createPreset(tier);
  }

  function handleCopy() {
    if (!createdVault) return;
    navigator.clipboard.writeText(createdVault);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function handleStartOver() {
    setCreatedVault(null);
    setCreateMode("idle");
    resetCreate();
  }

  return (
    <div className="space-y-8">
      {/* Status + identity — orchid accent aligned with the V2 brand
          (the V2 vault cards in the directory already use orchid borders).
          The phosphor green stays elsewhere where it carries semantic
          meaning (verifiable proof rows, post-create success card). */}
      <div className="border-l-2 border-orchid/60 pl-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">Genesis Canary · V2</Badge>
          <Badge variant="success">Proof vault</Badge>
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-kicker text-orchid">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orchid animate-pulse-dot" />
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

      {/* Beta fee model — who pays Pyth + gas today */}
      <div className="border border-hairline bg-bg-elev/10 px-5 py-4 space-y-2">
        <div className="font-mono text-[9px] uppercase tracking-kicker text-amber">
          Beta — fee model
        </div>
        <p className="font-mono text-[11px] text-ink-dim leading-relaxed">
          Pyth oracle fees (~{T.oracleFeeOg} OG per execution) and keeper gas are sponsored by
          Sentri during the beta. User-funded fee buffers are planned for V2.1 (contract redeploy,
          not a config flip).
        </p>
      </div>

      {/* Beta access — concrete next-step instructions for users / judges.
          The V2 keeper runs a strict allowlist; without explicit onboarding,
          a freshly-created V2 vault stays dormant. State that plainly. */}
      <div className="border border-amber/30 bg-amber/5 px-5 py-4 space-y-3">
        <div className="font-mono text-[9px] uppercase tracking-kicker text-amber">
          Beta access — how to join
        </div>
        {/* Step 1 — deploy via on-page wizard. If the vault is already
            created, swap the step for a success card that lets the user copy
            the new address and jump to Telegram in one click. */}
        {createdVault ? (
          <div className="border border-phosphor/40 bg-phosphor/5 px-4 py-3 space-y-3">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-kicker text-phosphor">
              <Check className="h-3.5 w-3.5" />
              <span>V2 vault deployed</span>
            </div>
            <div className="space-y-1.5">
              <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
                Your vault address
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-[11px] text-ink break-all">{createdVault}</code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="font-mono text-[10px] uppercase tracking-kicker text-amber hover:text-ink transition-colors flex items-center gap-1"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                <Button className="min-w-[200px]">
                  Send to {TELEGRAM_HANDLE} on Telegram
                </Button>
              </a>
              <Link
                href={`/v/${createdVault}`}
                className="font-mono text-[10px] uppercase tracking-kicker text-amber hover:text-ink transition-colors flex items-center self-center"
              >
                Open vault page →
              </Link>
              <button
                type="button"
                onClick={handleStartOver}
                className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim hover:text-amber transition-colors self-center"
              >
                Deploy another
              </button>
            </div>
            <p className="font-mono text-[10px] text-ink-faint leading-relaxed">
              The vault is created empty. Deposit base tokens from the vault page when ready.
            </p>
          </div>
        ) : createMode === "preset" ? (
          <div className="space-y-3">
            <p className="font-mono text-[11px] text-ink-dim leading-snug">
              <span className="text-amber">1.</span> Pick a preset and sign one transaction:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[PresetTier.Conservative, PresetTier.Balanced, PresetTier.Aggressive].map((t) => {
                const preset = PRESET_LABELS[t];
                const selected = tier === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTier(t)}
                    disabled={isCreating || isCreateConfirming}
                    className={cn(
                      "border p-3 text-left transition-colors disabled:opacity-50",
                      selected
                        ? "border-amber bg-amber/10"
                        : "border-hairline hover:border-amber/40 bg-bg-elev/20",
                    )}
                  >
                    <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1">
                      Tier {String(t).padStart(2, "0")}
                    </div>
                    <div className="font-mono text-[12px] text-ink leading-snug">{preset.name}</div>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={handleCreate}
                disabled={!connectedAddress || isCreating || isCreateConfirming}
                className="min-w-[200px]"
              >
                {!connectedAddress
                  ? "Connect wallet first"
                  : isCreating
                    ? "Awaiting signature…"
                    : isCreateConfirming
                      ? "Confirming on-chain…"
                      : `Deploy ${PRESET_LABELS[tier].name} V2 vault`}
              </Button>
              <button
                type="button"
                onClick={() => setCreateMode("idle")}
                disabled={isCreating || isCreateConfirming}
                className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim hover:text-amber transition-colors disabled:opacity-50 self-center"
              >
                ← Cancel
              </button>
            </div>
            <p className="font-mono text-[10px] text-ink-faint leading-relaxed">
              The vault is created empty. You can deposit (recommended ≥ ${T.recommendedMinTreasuryUsd.toLocaleString()})
              {" "}from the vault detail page after deployment.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="font-mono text-[11px] text-ink-dim leading-snug">
              <span className="text-amber">1.</span> Deploy a V2 vault from this page — one
              transaction, one preset, no upfront deposit required.
            </p>
            <Button
              onClick={() => setCreateMode("preset")}
              className="min-w-[200px]"
            >
              Create a V2 vault
            </Button>
          </div>
        )}

        {/* Step 2 — Telegram handoff */}
        <p className="font-mono text-[11px] text-ink-dim leading-snug">
          <span className="text-amber">2.</span> Send your vault address on Telegram to{" "}
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber hover:underline"
          >
            {TELEGRAM_HANDLE}
          </a>
          .
        </p>

        {/* Step 3 — allowlist + dormant safety note */}
        <p className="font-mono text-[11px] text-ink-dim leading-snug">
          <span className="text-amber">3.</span> Allowlist update within 24h. Your vault is then
          auto-cycled by the keeper. Until then it stays dormant — no funds at risk.
        </p>
      </div>

      {/* Honest status note */}
      <p className="font-mono text-[11px] text-ink-faint leading-relaxed border border-hairline bg-bg-elev/10 px-5 py-4">
        Genesis Canary — deployed and verified on 0G mainnet as a proof vault. Standard vaults are
        unaffected by V2 keeper state.
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
