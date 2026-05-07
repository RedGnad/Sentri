"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type PreviousExecutionSnapshot = {
  vaultAddress: `0x${string}`;
  logCount: bigint;
};

/**
 * Fires a single non-intrusive toast when a vault's `executionLogCount`
 * increases — i.e. when the agent has just submitted a successful
 * `executeStrategy` call on chain. Designed to surface autonomous
 * activity in the UI without any new backend, websocket, or polling
 * machinery: the existing `useParsedVaultData` poll already retrieves
 * the count every 10s, so we only need to compare against the previous
 * value held in a ref.
 *
 * Implementation contract:
 * - Skipped on the first observation of `logCount` for this mount, so
 *   the toast does not fire on initial page load.
 * - Fires only when `logCount` strictly increases (executions only —
 *   not skips, not price pushes).
 * - Auto-dismisses after 7 seconds.
 * - Includes a "View audit" action that routes to `/v/<address>/audit`.
 *
 * Anti-patterns this deliberately avoids:
 * notification center, browser push, websocket, sound, modal, multiple
 * stacked toasts on a single delta, or toasts on skipped cycles.
 */
export function useExecutionToast(
  vaultAddress: `0x${string}` | undefined,
  logCount: bigint | undefined,
): void {
  const previousSnapshot = useRef<PreviousExecutionSnapshot | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!vaultAddress || logCount === undefined) return;

    const previous = previousSnapshot.current;

    if (!previous || previous.vaultAddress !== vaultAddress) {
      previousSnapshot.current = { vaultAddress, logCount };
      return;
    }

    if (logCount > previous.logCount) {
      toast("New agent decision", {
        description: "Execution confirmed on 0G mainnet · TEE signer verified",
        action: {
          label: "View audit",
          onClick: () => router.push(`/v/${vaultAddress}/audit`),
        },
        duration: 7_000,
      });
    }

    previousSnapshot.current = { vaultAddress, logCount };
  }, [vaultAddress, logCount, router]);
}
