"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useVaultStateFromAgent } from "@/hooks/use-vault-runtime";
import { BASE_SYMBOL, IS_MAINNET, MOCK_USDC_ADDRESS, RISK_SYMBOL } from "@/config/contracts";

export default function VaultOverviewPage() {
  const params = useParams<{ address: string }>();
  const address = params.address as `0x${string}`;
  const { address: connected } = useAccount();

  const { data: vault, isLoading } = useParsedVaultData(address);
  const { data: usdcBalance } = useUsdcBalance(connected);
  const { data: allowance } = useUsdcAllowance(connected, address);
  const { data: agentState } = useVaultStateFromAgent(address);

  const { approve, isPending: isApproving, isConfirming: isApproveConfirming, isSuccess: approveSuccess, error: approveError } = useApproveUsdc();
  const { deposit, isPending: isDepositing, isConfirming: isDepositConfirming, isSuccess: depositSuccess, error: depositError } = useDeposit();
  const { withdraw, isPending: isWithdrawing, isConfirming: isWithdrawConfirming, isSuccess: withdrawSuccess, error: withdrawError } = useWithdraw();
  const { mint, isPending: isMinting, isConfirming: isMintConfirming, isSuccess: mintSuccess, error: mintError } = useMintUsdc();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const depositRef = useRef(depositAmount); depositRef.current = depositAmount;
  const withdrawRef = useRef(withdrawAmount); withdrawRef.current = withdrawAmount;

  useEffect(() => { if (mintSuccess) toast.success(`10,000 ${BASE_SYMBOL} minted`); }, [mintSuccess]);
  useEffect(() => { if (mintError) toast.error(`Mint failed: ${mintError.message}`); }, [mintError]);
  useEffect(() => { if (approveSuccess) toast.success(`${BASE_SYMBOL} approved for deposit`); }, [approveSuccess]);
  useEffect(() => { if (approveError) toast.error(`Approve failed: ${approveError.message}`); }, [approveError]);
  useEffect(() => {
    if (depositSuccess) { toast.success(`Deposited ${depositRef.current} ${BASE_SYMBOL}`); setDepositAmount(""); }
  }, [depositSuccess]);
  useEffect(() => { if (depositError) toast.error(`Deposit failed: ${depositError.message}`); }, [depositError]);
  useEffect(() => {
    if (withdrawSuccess) { toast.success(`Withdrew ${withdrawRef.current} ${BASE_SYMBOL}`); setWithdrawAmount(""); }
  }, [withdrawSuccess]);
  useEffect(() => { if (withdrawError) toast.error(`Withdraw failed: ${withdrawError.message}`); }, [withdrawError]);

  if (isLoading || !vault) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const pnl = vault.highWaterMark > 0n
    ? Number(((vault.totalValue - vault.highWaterMark) * 10000n) / vault.highWaterMark) / 100
    : 0;

  const userUsdc = (usdcBalance as bigint) ?? 0n;
  const currentAllowance = (allowance as bigint) ?? 0n;
  const depositNum = Number(depositAmount) || 0;
  const withdrawNum = Number(withdrawAmount) || 0;
  const depositWei = BigInt(Math.floor(depositNum * 1e6));
  const withdrawWei = BigInt(Math.floor(withdrawNum * 1e6));
  const needsApproval = depositAmount ? currentAllowance < depositWei : false;
  const depositInsufficient = depositAmount.length > 0 && depositWei > userUsdc;
  const withdrawInsufficient = withdrawAmount.length > 0 && withdrawWei > vault.balance;
  const isOwner = connected?.toLowerCase() === vault.owner.toLowerCase();

  return (
    <div className="space-y-8">
      {/* Stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 border border-hairline divide-x divide-hairline">
        <Stat label="Total Value" value={`$${formatUSDC(vault.totalValue)}`} sub={`${formatUSDC(vault.balance)} ${BASE_SYMBOL} + ${(Number(vault.riskBalance) / 1e18).toFixed(4)} ${RISK_SYMBOL}`} />
        <Stat label="High Water Mark" value={`$${formatUSDC(vault.highWaterMark)}`} sub="Peak TVL" />
        <Stat label="P&L from HWM" value={`${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`} sub={pnl >= 0 ? "Above peak" : "Drawdown"} valueClass={pnl >= 0 ? "text-phosphor" : "text-alert"} />
        <Stat label="Executions" value={vault.logCount.toString()} sub="On-chain" />
      </section>

      {/* Agent runtime panel */}
      <section className="border border-hairline">
        <header className="flex items-center justify-between px-5 h-9 border-b border-hairline">
          <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">Agent · this vault</span>
          <AgentDot status={agentState?.runtime?.lastOutcome?.status} />
        </header>
        <div className="px-5 py-5">
          {!agentState?.portfolio && !agentState?.runtime ? (
            <p className="font-mono text-[11px] text-ink-faint leading-relaxed">
              ∅ Agent has not iterated on this vault yet. The runtime polls the factory every cycle and picks up new vaults on its next pass.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              <Field label="Last action" value={agentState?.portfolio?.lastAction ?? agentState?.runtime?.lastOutcome?.status ?? "—"} />
              <Field label="Last iter" value={agentState?.runtime?.lastIterationAt ? new Date(agentState.runtime.lastIterationAt).toLocaleTimeString() : "—"} tabular />
              <Field label="Total iters" value={String(agentState?.runtime?.totalIterations ?? 0)} tabular />
              <Field label="Errors" value={String(agentState?.runtime?.totalErrors ?? 0)} valueClass={(agentState?.runtime?.totalErrors ?? 0) > 0 ? "text-alert" : "text-ink-dim"} />
            </div>
          )}
        </div>
      </section>

      {/* Vault info + your USDC */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-hairline">
          <header className="px-5 h-9 border-b border-hairline flex items-center">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">Vault info</span>
          </header>
          <ul>
            <DataRow label="Address" value={shortenAddress(address)} mono />
            <DataRow label="Owner" value={shortenAddress(vault.owner)} mono />
            <DataRow label="Agent" value={shortenAddress(vault.agent)} mono />
            {vault.policy && (
              <>
                <DataRow label={`Max ${RISK_SYMBOL} exposure`} value={`${bpsToPercent(vault.policy.maxAllocationBps)} %`} accent />
                <DataRow label="Max drawdown" value={`${bpsToPercent(vault.policy.maxDrawdownBps)} %`} accent />
                <DataRow label="Min action spacing" value={`${vault.policy.cooldownPeriod} s`} accent />
              </>
            )}
          </ul>
        </div>

        <div className="border border-hairline">
          <header className="px-5 h-9 border-b border-hairline flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">Your {BASE_SYMBOL}</span>
            <span className="font-mono text-[11px] text-ink tabular">${formatUSDC(userUsdc)}</span>
          </header>
          <div className="px-5 py-5 space-y-3">
            <p className="text-[13px] text-ink-dim leading-relaxed">
              {IS_MAINNET
                ? `Deposit ${BASE_SYMBOL} to fund this vault. Deposits are pooled into the vault's TVL — the agent will operate on them on its next cycle.`
                : `Mint testnet ${BASE_SYMBOL} to fund this vault. Deposits are pooled into the vault's TVL — the agent will operate on them on its next cycle.`}
            </p>
            {!connected ? (
              <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
                Connect a wallet to mint or interact.
              </p>
            ) : IS_MAINNET ? (
              <p className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">
                Mainnet mode: acquire {BASE_SYMBOL} externally, then deposit below.
              </p>
            ) : (
              <Button variant="outline" size="sm" className="w-full" onClick={() => mint(connected, "10000")} disabled={isMinting || isMintConfirming}>
                {isMinting ? "Confirm in wallet..." : isMintConfirming ? "Minting..." : `Mint 10,000 ${BASE_SYMBOL}`}
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Deposit / Withdraw */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-hairline">
          <header className="px-5 h-9 border-b border-hairline flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-amber">↘ Deposit</span>
            <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">Anyone</span>
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
                disabled={!connected}
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
            <div className="flex items-center justify-between font-mono text-[10px] text-ink-faint tabular">
              <span>Available: ${formatUSDC(userUsdc)}</span>
              {depositInsufficient && <span className="text-alert">Insufficient balance</span>}
            </div>
            {!connected ? (
              <Button className="w-full" disabled>Connect wallet to deposit</Button>
            ) : needsApproval ? (
              <Button className="w-full" onClick={() => approve(address, depositAmount)} disabled={isApproving || isApproveConfirming || !depositAmount || depositNum <= 0 || depositInsufficient}>
                {isApproving ? "Confirm in wallet..." : isApproveConfirming ? "Approving..." : `Approve ${BASE_SYMBOL} →`}
              </Button>
            ) : (
              <Button className="w-full" onClick={() => deposit(address, depositAmount)} disabled={isDepositing || isDepositConfirming || !depositAmount || depositNum <= 0 || depositInsufficient}>
                {isDepositing ? "Confirm in wallet..." : isDepositConfirming ? "Depositing..." : "Deposit →"}
              </Button>
            )}
          </div>
        </div>

        <div className="border border-hairline">
          <header className="px-5 h-9 border-b border-hairline flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-dim">↗ Withdraw</span>
            <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint">Owner only</span>
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
              onClick={() => connected && withdraw(address, connected, withdrawAmount)}
              disabled={!isOwner || isWithdrawing || isWithdrawConfirming || !withdrawAmount || withdrawNum <= 0 || withdrawInsufficient}
            >
              {isWithdrawing ? "Confirm in wallet..." : isWithdrawConfirming ? "Withdrawing..." : "Withdraw"}
            </Button>
          </div>
        </div>
      </section>

      {/* hidden import keeper to silence unused-warning if MOCK_USDC_ADDRESS isn't read elsewhere */}
      <span className="hidden">{MOCK_USDC_ADDRESS}</span>
    </div>
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
      <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-2">{label}</div>
      <div className={`font-serif text-3xl tabular ${valueClass}`}>{value}</div>
      {sub && <div className="font-mono text-[10px] text-ink-faint mt-1.5 truncate">{sub}</div>}
    </div>
  );
}

function DataRow({ label, value, mono = false, accent = false }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <li className="flex items-center justify-between px-5 h-11 border-b border-hairline last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-faint">{label}</span>
      <span className={`tabular ${mono ? "font-mono text-[11px]" : "text-[13px]"} ${accent ? "text-amber" : "text-ink"}`}>
        {value}
      </span>
    </li>
  );
}

function Field({ label, value, tabular = false, valueClass = "text-ink" }: { label: string; value: string; tabular?: boolean; valueClass?: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint mb-1.5">{label}</div>
      <div className={`text-[14px] ${tabular ? "font-mono tabular" : ""} ${valueClass}`}>{value}</div>
    </div>
  );
}

function AgentDot({ status }: { status?: string }) {
  if (status === "executed") {
    return (
      <span className="font-mono text-[9px] uppercase tracking-kicker text-phosphor flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-phosphor animate-pulse-dot" />
        Last: executed
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="font-mono text-[9px] uppercase tracking-kicker text-amber flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber" />
        Last: skipped
      </span>
    );
  }
  if (status === "killed") {
    return (
      <span className="font-mono text-[9px] uppercase tracking-kicker text-alert flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-alert" />
        Killed
      </span>
    );
  }
  return (
    <span className="font-mono text-[9px] uppercase tracking-kicker text-ink-faint flex items-center gap-1.5">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-ink-faint" />
      No iterations yet
    </span>
  );
}
