"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUSDC, shortenAddress, bpsToPercent } from "@/lib/utils";
import {
  useParsedVaultData,
  useUsdcBalance,
  useUsdcAllowance,
  useApproveUsdc,
  useDeposit,
  useWithdraw,
  useMintUsdc,
} from "@/hooks/use-vault";
import { useAgentStatus } from "@/hooks/use-agent-status";

export default function VaultPage() {
  const { address } = useAccount();
  const { data: vault, isLoading } = useParsedVaultData();
  const { data: usdcBalance } = useUsdcBalance(address);
  const { data: allowance } = useUsdcAllowance(address);

  const { data: agentStatus } = useAgentStatus();
  const { approve, isPending: isApproving, isConfirming: isApproveConfirming, isSuccess: approveSuccess, error: approveError } = useApproveUsdc();
  const { deposit, isPending: isDepositing, isConfirming: isDepositConfirming, isSuccess: depositSuccess, error: depositError } = useDeposit();
  const { withdraw, isPending: isWithdrawing, isConfirming: isWithdrawConfirming, isSuccess: withdrawSuccess, error: withdrawError } = useWithdraw();
  const { mint, isPending: isMinting, isConfirming: isMintConfirming, isSuccess: mintSuccess, error: mintError } = useMintUsdc();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const depositAmountRef = useRef(depositAmount);
  depositAmountRef.current = depositAmount;
  const withdrawAmountRef = useRef(withdrawAmount);
  withdrawAmountRef.current = withdrawAmount;

  useEffect(() => { if (mintSuccess) toast.success("10,000 USDC minted to your wallet"); }, [mintSuccess]);
  useEffect(() => { if (mintError) toast.error(`Mint failed: ${mintError.message}`); }, [mintError]);
  useEffect(() => { if (approveSuccess) toast.success("USDC approved for deposit"); }, [approveSuccess]);
  useEffect(() => { if (approveError) toast.error(`Approve failed: ${approveError.message}`); }, [approveError]);
  useEffect(() => {
    if (depositSuccess) {
      toast.success(`Deposited ${depositAmountRef.current} USDC into vault`);
      setDepositAmount("");
    }
  }, [depositSuccess]);
  useEffect(() => { if (depositError) toast.error(`Deposit failed: ${depositError.message}`); }, [depositError]);
  useEffect(() => {
    if (withdrawSuccess) {
      toast.success(`Withdrew ${withdrawAmountRef.current} USDC from vault`);
      setWithdrawAmount("");
    }
  }, [withdrawSuccess]);
  useEffect(() => { if (withdrawError) toast.error(`Withdraw failed: ${withdrawError.message}`); }, [withdrawError]);

  if (!address) {
    return (
      <div className="space-y-10">
        <PageHeader num="01" section="Vault" title="Connect" subtitle="Plug a wallet to read the treasury state." />
        <div className="border border-hairline bg-bg-elev/20 py-20 text-center">
          <p className="font-serif italic text-xl text-ink-dim mb-2">
            Wallet not connected.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
            Use the Connect button in the header.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !vault) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const pnl = vault.highWaterMark > 0n
    ? Number(((vault.totalValue - vault.highWaterMark) * 10000n) / vault.highWaterMark) / 100
    : 0;
  const userUsdcBalance = (usdcBalance as bigint) ?? 0n;
  const currentAllowance = (allowance as bigint) ?? 0n;

  const depositNum = Number(depositAmount) || 0;
  const withdrawNum = Number(withdrawAmount) || 0;
  const depositAmountWei = BigInt(Math.floor(depositNum * 1e6));
  const withdrawAmountWei = BigInt(Math.floor(withdrawNum * 1e6));
  const needsApproval = depositAmount ? currentAllowance < depositAmountWei : false;
  const depositInsufficient = depositAmount.length > 0 && depositAmountWei > userUsdcBalance;
  const withdrawInsufficient = withdrawAmount.length > 0 && withdrawAmountWei > vault.balance;
  const isOwner = address?.toLowerCase() === vault.owner.toLowerCase();
  const status = vault.isKilled ? "killed" : vault.isPaused ? "paused" : "active";

  return (
    <div className="space-y-10">
      <header className="border-b border-hairline pb-6 flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint mb-3">
            § 01 · Vault
          </div>
          <h1 className="font-serif text-5xl sm:text-6xl text-ink tracking-tightest leading-none">
            Treasury
          </h1>
          <p className="font-serif italic text-lg text-ink-dim mt-3">
            Live state of the autonomous allocator.
          </p>
        </div>
        <StatusPill status={status} />
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 border border-hairline divide-x divide-hairline">
        <Stat label="Total Value" value={`$${formatUSDC(vault.totalValue)}`} sub={`${formatUSDC(vault.balance)} USDC + ${(Number(vault.riskBalance) / 1e18).toFixed(4)} WETH`} />
        <Stat label="High Water Mark" value={`$${formatUSDC(vault.highWaterMark)}`} sub="Peak TVL since inception" />
        <Stat
          label="P&L from HWM"
          value={`${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`}
          sub={pnl >= 0 ? "Above peak" : "Drawdown"}
          valueClass={pnl >= 0 ? "text-phosphor" : "text-alert"}
        />
        <Stat label="Executions" value={vault.logCount.toString()} sub="Logged on-chain" />
      </section>

      {/* Agent status */}
      <section className="border border-hairline">
        <header className="flex items-center justify-between px-5 h-9 border-b border-hairline">
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">
            Agent · runtime
          </span>
          <AgentLed status={agentStatus?.status} />
        </header>
        <div className="px-5 py-5">
          {!agentStatus || agentStatus.status === "unavailable" ? (
            <p className="font-mono text-[11px] text-ink-faint leading-relaxed">
              ∅ Agent runtime status unavailable. 0G Storage KV unreachable —
              the agent may not be running, or the storage endpoint is down.
            </p>
          ) : agentStatus.status === "idle" && !agentStatus.lastAction ? (
            <p className="font-mono text-[11px] text-ink-faint leading-relaxed">
              ∅ Agent has not executed yet. Start the runtime with{" "}
              <code className="px-1.5 py-0.5 border border-hairline-strong text-ink">pnpm agent</code>.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              <Field label="Last action" value={agentStatus.lastAction ?? "—"} />
              <Field
                label="Last execution"
                value={
                  agentStatus.lastActionTime
                    ? new Date(agentStatus.lastActionTime).toLocaleTimeString()
                    : "—"
                }
                tabular
              />
              <Field label="Total executions" value={String(agentStatus.totalExecutions ?? 0)} tabular />
              <Field label="Status" value={agentStatus.status} valueClass="text-phosphor" />
            </div>
          )}
        </div>
      </section>

      {/* Vault info + your USDC */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-hairline">
          <header className="px-5 h-9 border-b border-hairline flex items-center">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">
              Vault info
            </span>
          </header>
          <ul>
            <DataRow label="Owner" value={shortenAddress(vault.owner)} mono />
            <DataRow label="Agent" value={shortenAddress(vault.agent)} mono />
            {vault.policy && (
              <>
                <DataRow label="Max allocation" value={`${bpsToPercent(vault.policy.maxAllocationBps)} %`} accent />
                <DataRow label="Max drawdown" value={`${bpsToPercent(vault.policy.maxDrawdownBps)} %`} accent />
                <DataRow label="Cooldown" value={`${vault.policy.cooldownPeriod} s`} accent />
              </>
            )}
          </ul>
        </div>

        <div className="border border-hairline">
          <header className="px-5 h-9 border-b border-hairline flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">
              Your USDC
            </span>
            <span className="font-mono text-[11px] text-ink tabular">
              ${formatUSDC(userUsdcBalance)}
            </span>
          </header>
          <div className="px-5 py-5 space-y-3">
            <p className="text-[13px] text-ink-dim leading-relaxed">
              Mint testnet USDC to interact with the vault. No real value — Galileo testnet only.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => mint(address, "10000")}
              disabled={isMinting || isMintConfirming}
            >
              {isMinting ? "Confirm in wallet..." : isMintConfirming ? "Minting..." : "Mint 10,000 USDC"}
            </Button>
          </div>
        </div>
      </section>

      {/* Deposit / Withdraw */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Deposit */}
        <div className="border border-hairline">
          <header className="px-5 h-9 border-b border-hairline flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-amber">
              ↘ Deposit
            </span>
            <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
              Anyone
            </span>
          </header>
          <div className="px-5 py-5 space-y-3">
            <div className="relative">
              <Input
                type="number"
                placeholder="0.00"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                min="0"
                className="pr-16"
              />
              <button
                type="button"
                onClick={() => setDepositAmount(formatUSDC(userUsdcBalance))}
                className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-kicker text-amber hover:text-ink transition-colors px-2 py-1"
              >
                MAX
              </button>
            </div>
            <div className="flex items-center justify-between font-mono text-[10px] text-ink-faint tabular">
              <span>Available: ${formatUSDC(userUsdcBalance)}</span>
              {depositInsufficient && <span className="text-alert">Insufficient balance</span>}
            </div>
            {needsApproval ? (
              <Button
                className="w-full"
                onClick={() => approve(depositAmount)}
                disabled={isApproving || isApproveConfirming || !depositAmount || depositNum <= 0 || depositInsufficient}
              >
                {isApproving ? "Confirm in wallet..." : isApproveConfirming ? "Approving..." : "Approve USDC →"}
              </Button>
            ) : (
              <Button
                className="w-full"
                onClick={() => deposit(depositAmount)}
                disabled={isDepositing || isDepositConfirming || !depositAmount || depositNum <= 0 || depositInsufficient}
              >
                {isDepositing ? "Confirm in wallet..." : isDepositConfirming ? "Depositing..." : "Deposit →"}
              </Button>
            )}
          </div>
        </div>

        {/* Withdraw */}
        <div className="border border-hairline">
          <header className="px-5 h-9 border-b border-hairline flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">
              ↗ Withdraw
            </span>
            <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">
              Owner only
            </span>
          </header>
          <div className="px-5 py-5 space-y-3">
            <div className="relative">
              <Input
                type="number"
                placeholder="0.00"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                min="0"
                className="pr-16"
                disabled={!isOwner}
              />
              <button
                type="button"
                onClick={() => setWithdrawAmount(formatUSDC(vault.balance))}
                disabled={!isOwner}
                className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-kicker text-amber hover:text-ink transition-colors px-2 py-1 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                MAX
              </button>
            </div>
            <div className="flex items-center justify-between font-mono text-[10px] text-ink-faint tabular">
              <span>Vault: ${formatUSDC(vault.balance)}</span>
              {!isOwner && <span className="text-amber">Owner only</span>}
              {isOwner && withdrawInsufficient && <span className="text-alert">Exceeds balance</span>}
            </div>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => withdraw(address, withdrawAmount)}
              disabled={!isOwner || isWithdrawing || isWithdrawConfirming || !withdrawAmount || withdrawNum <= 0 || withdrawInsufficient}
            >
              {isWithdrawing ? "Confirm in wallet..." : isWithdrawConfirming ? "Withdrawing..." : "Withdraw"}
            </Button>
          </div>
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

function Stat({
  label,
  value,
  sub,
  valueClass = "text-ink",
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="px-5 py-5 bg-bg-elev/30 hover:bg-bg-elev/50 transition-colors">
      <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-2">
        {label}
      </div>
      <div className={`font-serif text-3xl tabular ${valueClass}`}>{value}</div>
      {sub && (
        <div className="font-mono text-[10px] text-ink-faint mt-1.5 truncate">{sub}</div>
      )}
    </div>
  );
}

function DataRow({
  label,
  value,
  mono = false,
  accent = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <li className="flex items-center justify-between px-5 h-11 border-b border-hairline last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
        {label}
      </span>
      <span
        className={`tabular ${mono ? "font-mono text-[11px]" : "text-[13px]"} ${
          accent ? "text-amber" : "text-ink"
        }`}
      >
        {value}
      </span>
    </li>
  );
}

function Field({
  label,
  value,
  tabular = false,
  valueClass = "text-ink",
}: {
  label: string;
  value: string;
  tabular?: boolean;
  valueClass?: string;
}) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">
        {label}
      </div>
      <div className={`text-[14px] ${tabular ? "font-mono tabular" : ""} ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: "active" | "paused" | "killed" }) {
  if (status === "killed") {
    return <Badge variant="destructive"><span className="inline-block w-1.5 h-1.5 rounded-full bg-alert mr-1.5" />Killed</Badge>;
  }
  if (status === "paused") {
    return <Badge variant="warning"><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber mr-1.5" />Paused</Badge>;
  }
  return <Badge variant="success"><span className="inline-block w-1.5 h-1.5 rounded-full bg-phosphor animate-pulse-dot mr-1.5" />Active</Badge>;
}

function AgentLed({ status }: { status?: string }) {
  if (status === "running") {
    return (
      <span className="font-mono text-[9px] uppercase tracking-kicker text-phosphor flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-phosphor animate-pulse-dot" />
        Online
      </span>
    );
  }
  if (status === "idle") {
    return (
      <span className="font-mono text-[9px] uppercase tracking-kicker text-amber flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber" />
        Cooldown
      </span>
    );
  }
  return (
    <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint flex items-center gap-1.5">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink-faint" />
      Offline
    </span>
  );
}
