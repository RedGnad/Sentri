"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatUSDC, shortenAddress, bpsToPercent } from "@/lib/utils";
import {
  useVaultData,
  useUsdcBalance,
  useUsdcAllowance,
  useApproveUsdc,
  useDeposit,
  useWithdraw,
  useMintUsdc,
} from "@/hooks/use-vault";
import { Wallet, ArrowUpRight, ArrowDownRight, TrendingUp, Shield, Activity } from "lucide-react";

export default function VaultPage() {
  const { address } = useAccount();
  const { data: vaultData, isLoading } = useVaultData();
  const { data: usdcBalance } = useUsdcBalance(address);
  const { data: allowance } = useUsdcAllowance(address);

  const { approve, isPending: isApproving } = useApproveUsdc();
  const { deposit, isPending: isDepositing } = useDeposit();
  const { withdraw, isPending: isWithdrawing } = useWithdraw();
  const { mint, isPending: isMinting } = useMintUsdc();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Wallet className="h-12 w-12 text-white/20 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
        <p className="text-white/50">Connect your wallet to view the vault dashboard.</p>
      </div>
    );
  }

  if (isLoading || !vaultData) {
    return <div className="text-center py-20 text-white/50">Loading vault data...</div>;
  }

  const balance = (vaultData[0]?.result as bigint) ?? 0n;
  const hwm = (vaultData[1]?.result as bigint) ?? 0n;
  const logCount = (vaultData[2]?.result as bigint) ?? 0n;
  const policyData = vaultData[3]?.result as [number, number, number, number] | undefined;
  const agentAddr = (vaultData[4]?.result as string) ?? "";
  const isKilled = (vaultData[5]?.result as boolean) ?? false;
  const isPaused = (vaultData[6]?.result as boolean) ?? false;
  const ownerAddr = (vaultData[7]?.result as string) ?? "";

  const pnl = hwm > 0n ? Number(((balance - hwm) * 10000n) / hwm) / 100 : 0;
  const userUsdcBalance = (usdcBalance as bigint) ?? 0n;
  const currentAllowance = (allowance as bigint) ?? 0n;

  const needsApproval = depositAmount
    ? currentAllowance < BigInt(Math.floor(Number(depositAmount) * 1e6))
    : false;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vault Overview</h1>
          <p className="text-white/50 text-sm">Treasury status and fund management</p>
        </div>
        <div className="flex items-center gap-2">
          {isKilled && <Badge variant="destructive">KILLED</Badge>}
          {isPaused && <Badge variant="warning">PAUSED</Badge>}
          {!isKilled && !isPaused && <Badge variant="success">ACTIVE</Badge>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-white/50 text-sm mb-1">
              <Wallet className="h-4 w-4" />
              Vault Balance
            </div>
            <p className="text-2xl font-bold">${formatUSDC(balance)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-white/50 text-sm mb-1">
              <TrendingUp className="h-4 w-4" />
              High Water Mark
            </div>
            <p className="text-2xl font-bold">${formatUSDC(hwm)}</p>
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
            <p className="text-2xl font-bold">{logCount.toString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Vault Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-white/50">Owner</span>
              <span className="font-mono">{shortenAddress(ownerAddr)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Agent</span>
              <span className="font-mono">{shortenAddress(agentAddr)}</span>
            </div>
            {policyData && (
              <>
                <div className="flex justify-between">
                  <span className="text-white/50">Max Allocation</span>
                  <span>{bpsToPercent(policyData[0])}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Max Drawdown</span>
                  <span>{bpsToPercent(policyData[1])}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Cooldown</span>
                  <span>{policyData[3]}s</span>
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
              disabled={isMinting}
            >
              {isMinting ? "Minting..." : "Mint 10,000 USDC (testnet)"}
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
            <Input
              type="number"
              placeholder="Amount (USDC)"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
            />
            {needsApproval ? (
              <Button
                className="w-full"
                onClick={() => approve(depositAmount)}
                disabled={isApproving || !depositAmount}
              >
                {isApproving ? "Approving..." : "Approve USDC"}
              </Button>
            ) : (
              <Button
                className="w-full"
                onClick={() => {
                  deposit(depositAmount);
                  setDepositAmount("");
                }}
                disabled={isDepositing || !depositAmount}
              >
                {isDepositing ? "Depositing..." : "Deposit"}
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
            <Input
              type="number"
              placeholder="Amount (USDC)"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
            />
            <Button
              className="w-full"
              variant="outline"
              onClick={() => {
                withdraw(address, withdrawAmount);
                setWithdrawAmount("");
              }}
              disabled={isWithdrawing || !withdrawAmount}
            >
              {isWithdrawing ? "Withdrawing..." : "Withdraw"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
