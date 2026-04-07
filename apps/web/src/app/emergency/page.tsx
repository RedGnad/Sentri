"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatUSDC } from "@/lib/utils";
import { useVaultData, useEmergencyWithdraw, usePause, useUnpause } from "@/hooks/use-vault";
import { AlertTriangle, Pause, Play, Skull } from "lucide-react";

export default function EmergencyPage() {
  const { address } = useAccount();
  const { data: vaultData, isLoading } = useVaultData();
  const { emergencyWithdraw, isPending: isKilling } = useEmergencyWithdraw();
  const { pause, isPending: isPausing } = usePause();
  const { unpause, isPending: isUnpausing } = useUnpause();

  const [confirmKill, setConfirmKill] = useState(false);

  if (isLoading || !vaultData) {
    return <div className="text-center py-20 text-white/50">Loading...</div>;
  }

  const balance = (vaultData[0]?.result as bigint) ?? 0n;
  const isKilled = (vaultData[5]?.result as boolean) ?? false;
  const isPaused = (vaultData[6]?.result as boolean) ?? false;
  const ownerAddr = (vaultData[7]?.result as string) ?? "";
  const isOwner = address?.toLowerCase() === ownerAddr.toLowerCase();

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Emergency Controls</h1>
        <p className="text-white/50 text-sm">
          Circuit breaker and kill-switch for the vault
        </p>
      </div>

      {/* Status */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <span className="text-white/50">Vault Status</span>
            {isKilled ? (
              <Badge variant="destructive">PERMANENTLY KILLED</Badge>
            ) : isPaused ? (
              <Badge variant="warning">PAUSED</Badge>
            ) : (
              <Badge variant="success">ACTIVE</Badge>
            )}
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-white/50">Vault Balance</span>
            <span className="font-semibold">${formatUSDC(balance)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Pause / Unpause */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isPaused ? (
              <Play className="h-5 w-5 text-emerald-400" />
            ) : (
              <Pause className="h-5 w-5 text-amber-400" />
            )}
            Circuit Breaker
          </CardTitle>
          <CardDescription>
            {isPaused
              ? "Vault is paused. Deposits, withdrawals, and agent executions are blocked."
              : "Pause the vault to temporarily block all operations."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPaused ? (
            <Button
              className="w-full"
              onClick={() => unpause()}
              disabled={!isOwner || isUnpausing || isKilled}
            >
              {isUnpausing ? "Unpausing..." : "Unpause Vault"}
            </Button>
          ) : (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => pause()}
              disabled={!isOwner || isPausing || isKilled}
            >
              {isPausing ? "Pausing..." : "Pause Vault"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Kill Switch */}
      <Card className="border-red-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-400">
            <Skull className="h-5 w-5" />
            Kill Switch
          </CardTitle>
          <CardDescription>
            Emergency withdraw ALL funds to owner and permanently disable the vault.
            This action is IRREVERSIBLE.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isKilled ? (
            <div className="text-center py-4">
              <Badge variant="destructive">Vault has been permanently killed</Badge>
            </div>
          ) : (
            <>
              {!confirmKill ? (
                <Button
                  className="w-full"
                  variant="destructive"
                  onClick={() => setConfirmKill(true)}
                  disabled={!isOwner}
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Activate Kill Switch
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300">
                    This will withdraw ${formatUSDC(balance)} USDC to the owner
                    and permanently kill the vault. Are you sure?
                  </div>
                  <div className="flex gap-3">
                    <Button
                      className="flex-1"
                      variant="outline"
                      onClick={() => setConfirmKill(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1"
                      variant="destructive"
                      onClick={() => emergencyWithdraw()}
                      disabled={isKilling}
                    >
                      {isKilling ? "Executing..." : "CONFIRM KILL"}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {!isOwner && (
            <p className="text-xs text-white/40 text-center">
              Only the vault owner can activate emergency controls.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
