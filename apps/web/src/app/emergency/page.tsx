"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatUSDC } from "@/lib/utils";
import { useParsedVaultData, useEmergencyWithdraw, usePause, useUnpause } from "@/hooks/use-vault";
import { AlertTriangle, Pause, Play, Skull } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function EmergencyPage() {
  const { address } = useAccount();
  const { data: vault, isLoading } = useParsedVaultData();
  const { emergencyWithdraw, isPending: isKilling, isSuccess: killSuccess, error: killError } = useEmergencyWithdraw();
  const { pause, isPending: isPausing, isSuccess: pauseSuccess, error: pauseError } = usePause();
  const { unpause, isPending: isUnpausing, isSuccess: unpauseSuccess, error: unpauseError } = useUnpause();

  const [confirmKill, setConfirmKill] = useState(false);

  // Toast feedback
  useEffect(() => { if (pauseSuccess) toast.success("Vault paused — all operations blocked"); }, [pauseSuccess]);
  useEffect(() => { if (pauseError) toast.error(`Pause failed: ${pauseError.message}`); }, [pauseError]);
  useEffect(() => { if (unpauseSuccess) toast.success("Vault unpaused — operations resumed"); }, [unpauseSuccess]);
  useEffect(() => { if (unpauseError) toast.error(`Unpause failed: ${unpauseError.message}`); }, [unpauseError]);
  useEffect(() => {
    if (killSuccess) {
      toast.error("Vault permanently killed. All funds withdrawn to owner.");
      setConfirmKill(false);
    }
  }, [killSuccess]);
  useEffect(() => { if (killError) toast.error(`Kill-switch failed: ${killError.message}`); }, [killError]);

  if (isLoading || !vault) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-64 mt-2" /></div>
        <Card><CardContent className="pt-6"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-40 mt-3" /></CardContent></Card>
      </div>
    );
  }

  const isOwner = address?.toLowerCase() === vault.owner.toLowerCase();

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
            {vault.isKilled ? (
              <Badge variant="destructive">PERMANENTLY KILLED</Badge>
            ) : vault.isPaused ? (
              <Badge variant="warning">PAUSED</Badge>
            ) : (
              <Badge variant="success">ACTIVE</Badge>
            )}
          </div>
          <div className="flex items-center justify-between mt-3">
            <span className="text-white/50">Vault Balance</span>
            <span className="font-semibold">${formatUSDC(vault.balance)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Pause / Unpause */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {vault.isPaused ? (
              <Play className="h-5 w-5 text-emerald-400" />
            ) : (
              <Pause className="h-5 w-5 text-amber-400" />
            )}
            Circuit Breaker
          </CardTitle>
          <CardDescription>
            {vault.isPaused
              ? "Vault is paused. Deposits, withdrawals, and agent executions are blocked."
              : "Pause the vault to temporarily block all operations."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {vault.isPaused ? (
            <Button
              className="w-full"
              onClick={() => unpause()}
              disabled={!isOwner || isUnpausing || vault.isKilled}
            >
              {isUnpausing ? "Unpausing..." : "Unpause Vault"}
            </Button>
          ) : (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => pause()}
              disabled={!isOwner || isPausing || vault.isKilled}
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
          {vault.isKilled ? (
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
                    This will withdraw ${formatUSDC(vault.balance)} USDC to the owner
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
