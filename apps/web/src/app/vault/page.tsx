"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
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
import { Wallet, ArrowUpRight, ArrowDownRight, TrendingUp, Shield, Activity, Bot } from "lucide-react";
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

  // Toast feedback
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
      <div className="flex flex-col items-center justify-center py-20">
        <Wallet className="h-12 w-12 text-white/20 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
        <p className="text-white/50">Connect your wallet to view the vault dashboard.</p>
      </div>
    );
  }

  if (isLoading || !vault) {
    return (
      <div className="space-y-6">
        <div><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-64 mt-2" /></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-4 w-24 mb-2" /><Skeleton className="h-8 w-32" /></CardContent></Card>
          ))}
        </div>
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vault Overview</h1>
          <p className="text-white/50 text-sm">Treasury status and fund management</p>
        </div>
        <div className="flex items-center gap-2">
          {vault.isKilled && <Badge variant="destructive">KILLED</Badge>}
          {vault.isPaused && <Badge variant="warning">PAUSED</Badge>}
          {!vault.isKilled && !vault.isPaused && <Badge variant="success">ACTIVE</Badge>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-white/50 text-sm mb-1">
              <Wallet className="h-4 w-4" />
              Total Value (TVL)
            </div>
            <p className="text-2xl font-bold">${formatUSDC(vault.totalValue)}</p>
            <p className="text-xs text-white/40 mt-1">
              ${formatUSDC(vault.balance)} USDC + {(Number(vault.riskBalance) / 1e18).toFixed(4)} WETH
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-white/50 text-sm mb-1">
              <TrendingUp className="h-4 w-4" />
              High Water Mark
            </div>
            <p className="text-2xl font-bold">${formatUSDC(vault.highWaterMark)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-white/50 text-sm mb-1">
              <Activity className="h-4 w-4" />
              P&L from HWM
            </div>
            <p className={`text-2xl font-bold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-white/50 text-sm mb-1">
              <Shield className="h-4 w-4" />
              Executions
            </div>
            <p className="text-2xl font-bold">{vault.logCount.toString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Agent Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-emerald-400" />
            Agent Status
          </CardTitle>
          <CardDescription>Autonomous treasury operator powered by 0G Sealed Inference</CardDescription>
        </CardHeader>
        <CardContent>
          {!agentStatus || agentStatus.status === "unavailable" ? (
            <div className="flex items-center gap-3 text-sm text-white/50">
              <div className="w-2 h-2 rounded-full bg-white/20" />
              <span>Agent status unavailable — 0G Storage not reachable</span>
            </div>
          ) : agentStatus.status === "idle" && !agentStatus.lastAction ? (
            <div className="flex items-center gap-3 text-sm text-white/50">
              <div className="w-2 h-2 rounded-full bg-white/20" />
              <span>Agent has not executed yet. Start it with <code className="px-1 py-0.5 bg-white/10 rounded text-xs">pnpm agent</code></span>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-white/40 text-xs mb-1">Status</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${agentStatus.status === "running" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                  <span className="font-medium capitalize">{agentStatus.status}</span>
                </div>
              </div>
              <div>
                <p className="text-white/40 text-xs mb-1">Last Action</p>
                <p className="font-medium">{agentStatus.lastAction ?? "—"}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs mb-1">Last Execution</p>
                <p className="font-medium">
                  {agentStatus.lastActionTime
                    ? new Date(agentStatus.lastActionTime).toLocaleTimeString()
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-white/40 text-xs mb-1">Total Executions</p>
                <p className="font-medium">{agentStatus.totalExecutions ?? 0}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Vault Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-white/50">Owner</span>
              <span className="font-mono">{shortenAddress(vault.owner)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Agent</span>
              <span className="font-mono">{shortenAddress(vault.agent)}</span>
            </div>
            {vault.policy && (
              <>
                <div className="flex justify-between">
                  <span className="text-white/50">Max Allocation</span>
                  <span>{bpsToPercent(vault.policy.maxAllocationBps)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Max Drawdown</span>
                  <span>{bpsToPercent(vault.policy.maxDrawdownBps)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Cooldown</span>
                  <span>{vault.policy.cooldownPeriod}s</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Your USDC */}
        <Card>
          <CardHeader>
            <CardTitle>Your USDC</CardTitle>
            <CardDescription>Balance: ${formatUSDC(userUsdcBalance)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => mint(address, "10000")}
              disabled={isMinting || isMintConfirming}
            >
              {isMinting ? "Confirm in wallet..." : isMintConfirming ? "Minting..." : "Mint 10,000 USDC (testnet)"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Deposit / Withdraw */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowDownRight className="h-5 w-5 text-emerald-400" />
              Deposit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-emerald-400 hover:text-emerald-300 font-medium px-2 py-1 rounded hover:bg-white/5 transition-colors"
              >
                MAX
              </button>
            </div>
            <div className="flex items-center justify-between text-xs text-white/40">
              <span>Available: ${formatUSDC(userUsdcBalance)}</span>
              {depositInsufficient && <span className="text-red-400">Insufficient balance</span>}
            </div>
            {needsApproval ? (
              <Button
                className="w-full"
                onClick={() => approve(depositAmount)}
                disabled={isApproving || isApproveConfirming || !depositAmount || depositNum <= 0 || depositInsufficient}
              >
                {isApproving ? "Confirm in wallet..." : isApproveConfirming ? "Approving..." : "Approve USDC"}
              </Button>
            ) : (
              <Button
                className="w-full"
                onClick={() => deposit(depositAmount)}
                disabled={isDepositing || isDepositConfirming || !depositAmount || depositNum <= 0 || depositInsufficient}
              >
                {isDepositing ? "Confirm in wallet..." : isDepositConfirming ? "Depositing..." : "Deposit"}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowUpRight className="h-5 w-5 text-amber-400" />
              Withdraw
            </CardTitle>
            <CardDescription>Owner only</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-emerald-400 hover:text-emerald-300 font-medium px-2 py-1 rounded hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                MAX
              </button>
            </div>
            <div className="flex items-center justify-between text-xs text-white/40">
              <span>Vault: ${formatUSDC(vault.balance)}</span>
              {!isOwner && <span className="text-amber-400">Owner only</span>}
              {isOwner && withdrawInsufficient && <span className="text-red-400">Exceeds vault balance</span>}
            </div>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => withdraw(address, withdrawAmount)}
              disabled={!isOwner || isWithdrawing || isWithdrawConfirming || !withdrawAmount || withdrawNum <= 0 || withdrawInsufficient}
            >
              {isWithdrawing ? "Confirm in wallet..." : isWithdrawConfirming ? "Withdrawing..." : "Withdraw"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
