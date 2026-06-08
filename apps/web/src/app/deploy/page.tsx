"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useActiveAddress } from "@/hooks/use-active-account";
import { toast } from "sonner";
import { decodeEventLog, parseUnits, formatUnits } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { TrustlessVaultPanel } from "@/components/trustless-vault-panel";
import { useCreateVault } from "@/hooks/use-factory";
import { useApproveUsdc, useUsdcBalance, useUsdcAllowance, useMintUsdc } from "@/hooks/use-vault";
import { useGaslessDeposit } from "@/hooks/use-gasless-deposit";
import {
  BASE_SYMBOL,
  IS_MAINNET,
  PRESET_LABELS,
  PresetTier,
  RISK_SYMBOL,
  USDCE_SWAP_URL,
  VAULT_FACTORY_ADDRESS,
  VAULT_FACTORY_ABI,
} from "@/config/contracts";
import { formatUSDC, cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4;
type VaultType = "standard" | "trustless" | null;

export default function DeployPage() {
  const router = useRouter();
  // Single identity source: the smart account in gasless mode (what owns the
  // vault + holds funds), the wagmi account otherwise.
  const address = useActiveAddress();

  const [vaultType, setVaultType] = useState<VaultType>(null);
  const [step, setStep] = useState<Step>(1);
  const [tier, setTier] = useState<number>(PresetTier.Balanced);
  const [depositAmount, setDepositAmount] = useState<string>("1000");

  // Gasless path: when a Privy smart wallet is active, funds come from the smart
  // account (not the embedded EOA) and the deposit is a single sponsored UserOp.
  // When no smart wallet is present, everything falls back to the wagmi flow.
  const gasless = useGaslessDeposit();
  const gaslessReady = gasless.isReady;
  const effectiveAccount = address;

  const { data: usdcBalance, isSuccess: balanceLoaded } = useUsdcBalance(effectiveAccount);
  const { data: allowance } = useUsdcAllowance(effectiveAccount, VAULT_FACTORY_ADDRESS);
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

  useEffect(() => { if (mintSuccess) toast.success(`10,000 ${BASE_SYMBOL} minted`); }, [mintSuccess]);
  useEffect(() => { if (approveSuccess) toast.success(`${BASE_SYMBOL} approved for factory`); }, [approveSuccess]);
  useEffect(() => { if (gasless.error) toast.error(`Gasless deposit failed: ${gasless.error.message}`); }, [gasless.error]);

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
    // Gasless: one signature, sponsored UserOp (approve + create+deposit batched).
    if (gaslessReady) {
      void gasless.gaslessDeposit(tier, String(depositNum)).then((r) => {
        if (r?.vault) {
          toast.success(`Vault deployed: ${r.vault.slice(0, 10)}…`);
          router.push(`/v/${r.vault}`);
        }
      });
      return;
    }
    if (depositNum > 0) {
      createPresetAndDeposit(tier, String(depositNum));
    } else {
      createPreset(tier);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────

  const subtitle =
    vaultType === "trustless"
      ? "Premium high-assurance execution path"
      : vaultType === "standard"
        ? "Preset policy · optional seed deposit · owner-controlled after deployment"
        : "Choose an execution tier";

  return (
    <div className="space-y-10 max-w-3xl">
      <PageHeader num="02" section="Deploy" title="New Vault" subtitle={subtitle} />

      {vaultType === null && (
        <VaultTypeSelect
          onStandard={() => setVaultType("standard")}
          onTrustless={() => setVaultType("trustless")}
        />
      )}

      {vaultType === "trustless" && (
        <TrustlessVaultPanel onBack={() => setVaultType(null)} />
      )}

      {vaultType === "standard" && (
        <div className="space-y-10">
          <button
            type="button"
            onClick={() => setVaultType(null)}
            className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim hover:text-amber transition-colors"
          >
            ← Vault type
          </button>

          <Stepper current={step} />

          {step === 1 && (
            <PresetStep tier={tier} setTier={setTier} onNext={() => setStep(2)} />
          )}

      {step === 2 && (
        <DepositStep
          depositAmount={depositAmount}
          setDepositAmount={setDepositAmount}
          userUsdc={userUsdc}
          balanceLoaded={balanceLoaded}
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
          gasless={gaslessReady}
          gaslessPending={gasless.isPending}
          onApprove={() => approve(VAULT_FACTORY_ADDRESS, depositAmount)}
          onSubmit={handleSubmit}
          onBack={() => setStep(3)}
        />
      )}
        </div>
      )}
    </div>
  );
}

function VaultTypeSelect({
  onStandard,
  onTrustless,
}: {
  onStandard: () => void;
  onTrustless: () => void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="font-serif text-3xl text-ink">Choose an execution tier</h2>
      <p className="font-serif italic text-base text-ink-dim">
        Two paths, one agent doctrine. Standard for cheap, frequent retail treasuries; Trustless
        Oracle is currently a V2 Genesis Canary while audit parity is finalized.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={onStandard}
          className="group border border-hairline hover:border-hairline-strong bg-bg-elev/20 p-6 text-left transition-colors flex flex-col"
        >
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="success">Live</Badge>
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">Retail</span>
          </div>
          <h3 className="font-serif text-2xl text-ink mb-2">Standard Vault</h3>
          <p className="text-[12px] text-ink-dim leading-relaxed mb-4 flex-1">
            Keeper-attested oracle. Low-cost, frequent rebalancing, no per-execution oracle fee.
            The retail-friendly path.
          </p>
          <ul className="space-y-1.5 mb-5">
            <li className="font-mono text-[10px] text-ink-dim">· cheap · frequent execution</li>
            <li className="font-mono text-[10px] text-ink-dim">· private AI reasoning + on-chain policy</li>
            <li className="font-mono text-[10px] text-ink-dim">· any treasury size</li>
          </ul>
          <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mb-3">
            Capital: {BASE_SYMBOL} · Gas: 0G
          </div>
          <span className="font-mono text-[10px] uppercase tracking-kicker text-amber group-hover:text-ink transition-colors">
            Create →
          </span>
        </button>

        <button
          type="button"
          onClick={onTrustless}
          className="group border border-orchid/30 hover:border-orchid/60 bg-bg-elev/30 p-6 text-left transition-colors flex flex-col"
        >
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge variant="warning">Genesis Canary · V2</Badge>
            <Badge variant="success">Proof vault</Badge>
          </div>
          <h3 className="font-serif text-2xl text-ink mb-2">
            Advanced Oracle Vault
            <span className="block font-mono text-[9px] uppercase tracking-kicker text-ink-faint mt-1">
              Trustless Oracle engine
            </span>
          </h3>
          <p className="text-[12px] text-ink-dim leading-relaxed mb-4 flex-1">
            Fresh Pyth market data verified on-chain inside the execution transaction, before
            policy checks and swap. Higher-assurance, opt-in.
          </p>
          <ul className="space-y-1.5 mb-5">
            <li className="font-mono text-[10px] text-ink-dim">· verified oracle per execution</li>
            <li className="font-mono text-[10px] text-ink-dim">· recommended ≥ $1,000 treasury · higher gas</li>
            <li className="font-mono text-[10px] text-ink-dim">· verified on 0G mainnet</li>
          </ul>
          <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mb-3">
            Capital: {BASE_SYMBOL} · Gas: 0G · Oracle: OG (sponsored)
          </div>
          <span className="font-mono text-[10px] uppercase tracking-kicker text-phosphor group-hover:text-ink transition-colors">
            Explore tier →
          </span>
        </button>
      </div>
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
        Presets are the fastest safe path: max {RISK_SYMBOL} exposure, drawdown freeze,
        slippage cap, and minimum action spacing. The vault owner can update these
        bounds on-chain after deployment.
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
        The agent can check often; the vault enforces how often it may actually execute.
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
  balanceLoaded,
  connected,
  onMint,
  isMinting,
  onBack,
  onNext,
}: {
  depositAmount: string;
  setDepositAmount: (v: string) => void;
  userUsdc: bigint;
  balanceLoaded: boolean;
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
            Amount ({BASE_SYMBOL})
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
                onClick={() => setDepositAmount(formatUnits(userUsdc, 6))}
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

        {!IS_MAINNET && connected && userUsdc < parseUnits("1000", 6) && (
          <div className="border border-hairline-strong p-3 space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
              Need testnet {BASE_SYMBOL}?
            </p>
            <Button variant="outline" size="sm" onClick={onMint} disabled={isMinting} className="w-full">
              {isMinting ? "Minting..." : `Mint 10,000 ${BASE_SYMBOL} (testnet, free)`}
            </Button>
          </div>
        )}

        {IS_MAINNET && connected && balanceLoaded && userUsdc === 0n && (
          <div className="border border-amber/30 bg-amber/5 px-4 py-3 space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-kicker text-amber">
              No {BASE_SYMBOL} detected.
            </p>
            <p className="font-mono text-[10px] text-ink-dim leading-relaxed">
              Fund vaults with {BASE_SYMBOL}. Keep 0G for gas.
            </p>
            {USDCE_SWAP_URL && (
              <a
                href={USDCE_SWAP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] uppercase tracking-kicker text-amber hover:text-ink transition-colors inline-flex items-center gap-1"
              >
                Get {BASE_SYMBOL} ↗
              </a>
            )}
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
        <ConfirmRow label="Initial deposit" value={depositNum > 0 ? `$${depositNum.toLocaleString()} ${BASE_SYMBOL}` : "None (deploy empty)"} accent />
        <ConfirmRow label="Owner" value="You (the connected wallet)" />
        <ConfirmRow label="Agent" value="0G Sealed Inference (shared)" />
        <ConfirmRow label="Strategy" value={`Stables-first · max 30% ${RISK_SYMBOL} · auto-deleverage on drawdown`} />
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
  gasless,
  gaslessPending,
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
  gasless: boolean;
  gaslessPending: boolean;
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

  // Gasless path (Privy smart wallet): one signature, no gas. The factory
  // create + deposit are batched into a single sponsored UserOp, so there's no
  // separate approve step and no native-token balance needed for gas.
  if (gasless) {
    return (
      <div className="space-y-6">
        <h2 className="font-serif text-3xl text-ink">Submit</h2>
        <p className="font-serif italic text-base text-ink-dim">
          One signature, no gas. Your {BASE_SYMBOL} deposit and the vault creation are
          sent together as a single sponsored transaction.
        </p>

        {depositNum <= 0 && (
          <div className="border border-amber/40 bg-amber/[0.04] px-4 py-3 font-mono text-[11px] text-amber">
            Enter a deposit amount to create your vault.
          </div>
        )}
        {insufficient && (
          <div className="border border-alert/40 bg-alert/[0.04] px-4 py-3 font-mono text-[11px] text-alert">
            Insufficient {BASE_SYMBOL} balance for this deposit.
          </div>
        )}

        <Button
          className="w-full"
          onClick={onSubmit}
          disabled={gaslessPending || insufficient || depositNum <= 0}
        >
          {gaslessPending ? "Sponsoring…" : `Create vault + deposit ${depositNum} ${BASE_SYMBOL} ∎`}
        </Button>

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack} disabled={gaslessPending}>← Back</Button>
          <Link href="/vaults" className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim hover:text-amber transition-colors self-center">
            Cancel
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="font-serif text-3xl text-ink">Submit</h2>
      <p className="font-serif italic text-base text-ink-dim">
        {depositNum > 0
          ? `Two transactions: approve the factory to spend ${depositNum} ${BASE_SYMBOL}, then create your vault and deposit atomically.`
          : "One transaction: create your vault. You can deposit later."}
      </p>

      {insufficient && (
        <div className="border border-alert/40 bg-alert/[0.04] px-4 py-3 font-mono text-[11px] text-alert">
          Insufficient {BASE_SYMBOL} balance for this deposit.
        </div>
      )}

      <div className="space-y-3">
        {needsApproval && (
          <Button className="w-full" onClick={onApprove} disabled={isApproving || isApproveConfirming || insufficient}>
            {isApproving ? "Confirm in wallet..." : isApproveConfirming ? "Approving..." : `Step 1 / 2 — Approve ${depositNum} ${BASE_SYMBOL} →`}
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
