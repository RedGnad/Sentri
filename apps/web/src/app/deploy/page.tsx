"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { decodeEventLog, parseUnits } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { useCreateVault } from "@/hooks/use-factory";
import { useApproveUsdc, useUsdcBalance, useUsdcAllowance, useMintUsdc } from "@/hooks/use-vault";
import { PRESET_LABELS, PresetTier, VAULT_FACTORY_ADDRESS, VAULT_FACTORY_ABI } from "@/config/contracts";
import { formatUSDC, cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4;

export default function DeployPage() {
  const router = useRouter();
  const { address } = useAccount();

  const [step, setStep] = useState<Step>(1);
  const [tier, setTier] = useState<number>(PresetTier.Balanced);
  const [depositAmount, setDepositAmount] = useState<string>("1000");

  const { data: usdcBalance } = useUsdcBalance(address);
  const { data: allowance } = useUsdcAllowance(address, VAULT_FACTORY_ADDRESS);
  const { approve, isPending: isApproving, isConfirming: isApproveConfirming, isSuccess: approveSuccess } = useApproveUsdc();
  const { mint, isPending: isMinting, isConfirming: isMintConfirming, isSuccess: mintSuccess } = useMintUsdc();
  const {
    createPreset,
    createPresetAndDeposit,
    isPending: isCreating,
    isConfirming: isCreateConfirming,
    isSuccess: createSuccess,
    receipt,
  } = useCreateVault();

  useEffect(() => { if (mintSuccess) toast.success("10,000 USDC minted"); }, [mintSuccess]);
  useEffect(() => { if (approveSuccess) toast.success("USDC approved for factory"); }, [approveSuccess]);

  // Once vault is created, parse the VaultCreated event from the receipt and
  // redirect to the new vault's page.
  useEffect(() => {
    if (!createSuccess || !receipt) return;
    try {
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: VAULT_FACTORY_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "VaultCreated") {
            const args = decoded.args as { vault: `0x${string}` };
            toast.success(`Vault deployed: ${args.vault.slice(0, 10)}…`);
            router.push(`/v/${args.vault}`);
            return;
          }
        } catch {
          // not the VaultCreated event, skip
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, [createSuccess, receipt, router]);

  const userUsdc = (usdcBalance as bigint) ?? 0n;
  const currentAllowance = (allowance as bigint) ?? 0n;
  const depositNum = Number(depositAmount) || 0;
  const depositWei = depositNum > 0 ? parseUnits(String(depositNum), 6) : 0n;
  const needsApproval = depositWei > 0n && currentAllowance < depositWei;
  const insufficient = depositWei > userUsdc;

  function handleSubmit() {
    if (depositNum > 0) {
      createPresetAndDeposit(tier, String(depositNum));
    } else {
      createPreset(tier);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-10 max-w-3xl">
      <PageHeader
        num="02"
        section="Deploy"
        title="New Vault"
        subtitle="Four steps · ~30 seconds · two transactions max"
      />

      <Stepper current={step} />

      {step === 1 && (
        <PresetStep tier={tier} setTier={setTier} onNext={() => setStep(2)} />
      )}

      {step === 2 && (
        <DepositStep
          depositAmount={depositAmount}
          setDepositAmount={setDepositAmount}
          userUsdc={userUsdc}
          connected={!!address}
          onMint={() => address && mint(address, "10000")}
          isMinting={isMinting || isMintConfirming}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <ConfirmStep
          tier={tier}
          depositAmount={depositAmount}
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
        />
      )}

      {step === 4 && (
        <SubmitStep
          connected={!!address}
          insufficient={insufficient}
          needsApproval={needsApproval}
          depositAmount={depositAmount}
          isApproving={isApproving}
          isApproveConfirming={isApproveConfirming}
          isCreating={isCreating}
          isCreateConfirming={isCreateConfirming}
          onApprove={() => approve(VAULT_FACTORY_ADDRESS, depositAmount)}
          onSubmit={handleSubmit}
          onBack={() => setStep(3)}
        />
      )}
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const steps = ["Preset", "Deposit", "Confirm", "Submit"] as const;
  return (
    <ol className="flex items-center border border-hairline divide-x divide-hairline">
      {steps.map((label, i) => {
        const num = (i + 1) as Step;
        const active = current === num;
        const done = current > num;
        return (
          <li key={label} className={cn("flex-1 px-4 h-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-kicker", active ? "text-amber bg-bg-elev/40" : done ? "text-phosphor" : "text-ink-faint")}>
            <span className="tabular">{String(num).padStart(2, "0")}</span>
            <span>{label}</span>
            {active && <span className="ml-auto inline-block w-1.5 h-1.5 rounded-full bg-amber animate-pulse-dot" />}
            {done && <span className="ml-auto">✓</span>}
          </li>
        );
      })}
    </ol>
  );
}

function PresetStep({ tier, setTier, onNext }: { tier: number; setTier: (t: number) => void; onNext: () => void }) {
  const tiers = [PresetTier.Conservative, PresetTier.Balanced, PresetTier.Aggressive] as const;
  return (
    <div className="space-y-6">
      <h2 className="font-serif text-3xl text-ink">Choose a risk preset</h2>
      <p className="font-serif italic text-base text-ink-dim">
        Each preset bakes a vetted policy: max WETH allocation, drawdown freeze, slippage cap, cooldown.
        You can change the policy later as the vault owner.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tiers.map((t) => {
          const preset = PRESET_LABELS[t];
          const selected = tier === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className={cn(
                "border p-5 text-left transition-colors",
                selected ? "border-amber bg-bg-elev/40" : "border-hairline hover:border-hairline-strong bg-bg-elev/20",
              )}
            >
              <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mb-2">
                Tier {String(t).padStart(2, "0")}
              </div>
              <h3 className="font-serif text-2xl text-ink mb-2">{preset.name}</h3>
              <p className="text-[12px] text-ink-dim leading-relaxed mb-4 min-h-[40px]">{preset.description}</p>
              <ul className="space-y-1.5">
                {preset.bullets.map((b) => (
                  <li key={b} className="font-mono text-[10px] text-ink-dim">· {b}</li>
                ))}
              </ul>
              {selected && (
                <div className="font-mono text-[9px] uppercase tracking-kicker text-amber mt-4 flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber" />
                  Selected
                </div>
              )}
            </button>
          );
        })}
      </div>
      <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
        Custom policies (with bounded ranges) are supported on-chain and will land in the wizard in v1.1.
      </p>
      <div className="flex justify-end">
        <Button onClick={onNext}>Continue → Deposit</Button>
      </div>
    </div>
  );
}

function DepositStep({
  depositAmount,
  setDepositAmount,
  userUsdc,
  connected,
  onMint,
  isMinting,
  onBack,
  onNext,
}: {
  depositAmount: string;
  setDepositAmount: (v: string) => void;
  userUsdc: bigint;
  connected: boolean;
  onMint: () => void;
  isMinting: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="font-serif text-3xl text-ink">Initial deposit</h2>
      <p className="font-serif italic text-base text-ink-dim">
        Optional. You can deploy an empty vault and seed it later. If you set an amount, the
        factory will atomically create your vault AND deposit in a single transaction.
      </p>

      <div className="border border-hairline p-5 space-y-4">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint block mb-2">
            Amount (USDC)
          </label>
          <div className="relative">
            <Input
              type="number"
              placeholder="0.00"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              min="0"
              className="pr-16"
            />
            {connected && (
              <button
                type="button"
                onClick={() => setDepositAmount(formatUSDC(userUsdc))}
                className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-kicker text-amber hover:text-ink transition-colors px-2 py-1"
              >
                MAX
              </button>
            )}
          </div>
          <div className="flex items-center justify-between font-mono text-[10px] text-ink-faint tabular mt-2">
            <span>Your balance: ${formatUSDC(userUsdc)}</span>
            {!connected && <span className="text-amber">Connect wallet first</span>}
          </div>
        </div>

        {connected && userUsdc < parseUnits("1000", 6) && (
          <div className="border border-hairline-strong p-3 space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
              Need testnet USDC?
            </p>
            <Button variant="outline" size="sm" onClick={onMint} disabled={isMinting} className="w-full">
              {isMinting ? "Minting..." : "Mint 10,000 USDC (testnet, free)"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>← Back</Button>
        <Button onClick={onNext}>Continue → Confirm</Button>
      </div>
    </div>
  );
}

function ConfirmStep({
  tier,
  depositAmount,
  onBack,
  onNext,
}: {
  tier: number;
  depositAmount: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const preset = PRESET_LABELS[tier];
  const depositNum = Number(depositAmount) || 0;

  return (
    <div className="space-y-6">
      <h2 className="font-serif text-3xl text-ink">Review</h2>
      <p className="font-serif italic text-base text-ink-dim">
        Verify your selections. Submitting will create a vault contract owned by your wallet.
      </p>

      <ul className="border border-hairline divide-y divide-hairline">
        <ConfirmRow label="Risk tier" value={preset.name} />
        <ConfirmRow label="Description" value={preset.description} />
        {preset.bullets.map((b) => (
          <ConfirmRow key={b} label="" value={`· ${b}`} valueClass="text-ink-dim" />
        ))}
        <ConfirmRow label="Initial deposit" value={depositNum > 0 ? `$${depositNum.toLocaleString()} USDC` : "None (deploy empty)"} accent />
        <ConfirmRow label="Owner" value="You (the connected wallet)" />
        <ConfirmRow label="Agent" value="0G Sealed Inference (shared)" />
        <ConfirmRow label="Strategy" value="Stables-first · max 30% WETH · auto-deleverage on drawdown" />
      </ul>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>← Back</Button>
        <Button onClick={onNext}>Continue → Submit</Button>
      </div>
    </div>
  );
}

function SubmitStep({
  connected,
  insufficient,
  needsApproval,
  depositAmount,
  isApproving,
  isApproveConfirming,
  isCreating,
  isCreateConfirming,
  onApprove,
  onSubmit,
  onBack,
}: {
  connected: boolean;
  insufficient: boolean;
  needsApproval: boolean;
  depositAmount: string;
  isApproving: boolean;
  isApproveConfirming: boolean;
  isCreating: boolean;
  isCreateConfirming: boolean;
  onApprove: () => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const depositNum = Number(depositAmount) || 0;

  if (!connected) {
    return (
      <div className="border border-hairline p-8 text-center space-y-4">
        <p className="font-serif italic text-xl text-ink-dim">Connect your wallet to deploy.</p>
        <Button variant="outline" onClick={onBack}>← Back</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="font-serif text-3xl text-ink">Submit</h2>
      <p className="font-serif italic text-base text-ink-dim">
        {depositNum > 0
          ? `Two transactions: approve the factory to spend ${depositNum} USDC, then create your vault and deposit atomically.`
          : "One transaction: create your vault. You can deposit later."}
      </p>

      {insufficient && (
        <div className="border border-alert/40 bg-alert/[0.04] px-4 py-3 font-mono text-[11px] text-alert">
          Insufficient USDC balance for this deposit.
        </div>
      )}

      <div className="space-y-3">
        {needsApproval && (
          <Button className="w-full" onClick={onApprove} disabled={isApproving || isApproveConfirming || insufficient}>
            {isApproving ? "Confirm in wallet..." : isApproveConfirming ? "Approving..." : `Step 1 / 2 — Approve ${depositNum} USDC →`}
          </Button>
        )}
        <Button
          className="w-full"
          onClick={onSubmit}
          disabled={isCreating || isCreateConfirming || insufficient || (depositNum > 0 && needsApproval)}
        >
          {isCreating ? "Confirm in wallet..." : isCreateConfirming ? "Deploying..." : depositNum > 0 ? "Step 2 / 2 — Create vault + deposit ∎" : "Create vault ∎"}
        </Button>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={isApproving || isCreating || isCreateConfirming}>← Back</Button>
        <Link href="/vaults" className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim hover:text-amber transition-colors self-center">
          Cancel
        </Link>
      </div>
    </div>
  );
}

function ConfirmRow({ label, value, accent = false, valueClass = "text-ink" }: { label: string; value: string; accent?: boolean; valueClass?: string }) {
  return (
    <li className="flex items-center justify-between px-5 h-12 gap-4">
      <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">{label}</span>
      <span className={cn("text-[13px]", accent ? "text-amber font-mono tabular" : valueClass)}>{value}</span>
    </li>
  );
}
