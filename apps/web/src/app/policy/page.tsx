"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVaultData, useSetPolicy } from "@/hooks/use-vault";
import { bpsToPercent } from "@/lib/utils";
import { Settings, Info } from "lucide-react";

export default function PolicyPage() {
  const { address } = useAccount();
  const { data: vaultData, isLoading } = useVaultData();
  const { setPolicy, isPending, isConfirming, isSuccess } = useSetPolicy();

  const [maxAllocation, setMaxAllocation] = useState("");
  const [maxDrawdown, setMaxDrawdown] = useState("");
  const [rebalanceThreshold, setRebalanceThreshold] = useState("");
  const [cooldownPeriod, setCooldownPeriod] = useState("");

  const policyData = vaultData?.[3]?.result as [number, number, number, number] | undefined;
  const ownerAddr = (vaultData?.[7]?.result as string) ?? "";
  const isOwner = address?.toLowerCase() === ownerAddr.toLowerCase();

  useEffect(() => {
    if (policyData) {
      setMaxAllocation(bpsToPercent(policyData[0]));
      setMaxDrawdown(bpsToPercent(policyData[1]));
      setRebalanceThreshold(bpsToPercent(policyData[2]));
      setCooldownPeriod(policyData[3].toString());
    }
  }, [policyData]);

  if (isLoading) {
    return <div className="text-center py-20 text-white/50">Loading...</div>;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPolicy({
      maxAllocationBps: Math.round(Number(maxAllocation) * 100),
      maxDrawdownBps: Math.round(Number(maxDrawdown) * 100),
      rebalanceThresholdBps: Math.round(Number(rebalanceThreshold) * 100),
      cooldownPeriod: Number(cooldownPeriod),
    });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Risk Policy</h1>
        <p className="text-white/50 text-sm">
          On-chain risk parameters the agent must respect
        </p>
      </div>

      {/* Current Policy */}
      {policyData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-emerald-400" />
              Current Policy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-white/50">Max Allocation per Action</p>
                <p className="text-lg font-semibold">{bpsToPercent(policyData[0])}%</p>
              </div>
              <div>
                <p className="text-white/50">Max Drawdown from HWM</p>
                <p className="text-lg font-semibold">{bpsToPercent(policyData[1])}%</p>
              </div>
              <div>
                <p className="text-white/50">Rebalance Threshold</p>
                <p className="text-lg font-semibold">{bpsToPercent(policyData[2])}%</p>
              </div>
              <div>
                <p className="text-white/50">Cooldown Period</p>
                <p className="text-lg font-semibold">{policyData[3]}s</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Update Policy */}
      <Card>
        <CardHeader>
          <CardTitle>Update Policy</CardTitle>
          <CardDescription>
            {isOwner
              ? "Modify risk parameters (owner only)"
              : "Only the vault owner can modify policy"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-white/50 block mb-1">
                Max Allocation per Action (%)
              </label>
              <Input
                type="number"
                step="0.1"
                min="0.1"
                max="100"
                value={maxAllocation}
                onChange={(e) => setMaxAllocation(e.target.value)}
                disabled={!isOwner}
              />
            </div>
            <div>
              <label className="text-sm text-white/50 block mb-1">
                Max Drawdown from HWM (%)
              </label>
              <Input
                type="number"
                step="0.1"
                min="0.1"
                max="100"
                value={maxDrawdown}
                onChange={(e) => setMaxDrawdown(e.target.value)}
                disabled={!isOwner}
              />
            </div>
            <div>
              <label className="text-sm text-white/50 block mb-1">
                Rebalance Threshold (%)
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={rebalanceThreshold}
                onChange={(e) => setRebalanceThreshold(e.target.value)}
                disabled={!isOwner}
              />
            </div>
            <div>
              <label className="text-sm text-white/50 block mb-1">
                Cooldown Period (seconds)
              </label>
              <Input
                type="number"
                min="0"
                value={cooldownPeriod}
                onChange={(e) => setCooldownPeriod(e.target.value)}
                disabled={!isOwner}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={!isOwner || isPending || isConfirming}
            >
              {isPending
                ? "Confirming..."
                : isConfirming
                ? "Waiting for TX..."
                : isSuccess
                ? "Policy Updated!"
                : "Update Policy"}
            </Button>
          </form>

          <div className="mt-4 flex items-start gap-2 text-xs text-white/40">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              These parameters are enforced on-chain. The agent cannot execute
              any strategy that violates the policy. Changes take effect immediately.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
