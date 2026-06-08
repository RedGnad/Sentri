"use client";

import { useCallback, useState } from "react";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseUnits,
  decodeEventLog,
  erc20Abi,
  type Hex,
} from "viem";
import { galileo } from "@/config/wagmi";
import {
  BASE_TOKEN_ADDRESS,
  VAULT_FACTORY_ADDRESS,
  VAULT_FACTORY_ABI,
} from "@/config/contracts";

// NOTE (unverified end-to-end): this is the gasless path. It needs the live
// stack to validate — a reachable /paymaster signer, a running bundler, and the
// 0G chain configured in the Privy dashboard (bundler + paymaster URL, smart
// wallet type `safe`). The PAYMASTER_TARGET_ALLOWLIST on the signer must include
// BASE_TOKEN_ADDRESS (approve) and VAULT_FACTORY_ADDRESS (create) used here, or
// the paymaster will refuse to sponsor. Types are checked by tsc; behaviour is
// confirmed only against the live stack.

const publicClient = createPublicClient({ chain: galileo, transport: http() });

export interface GaslessDepositResult {
  txHash: Hex;
  vault: `0x${string}` | null;
}

/**
 * One-signature, gas-sponsored vault creation + deposit for Privy smart wallets.
 * Batches ERC-20 approve + factory createVaultAndDeposit into a single UserOp.
 * The configured paymaster (set in the Privy dashboard) sponsors the gas, so the
 * user signs once and pays no gas. Funds are pulled from the SMART ACCOUNT
 * (client.account.address), not the embedded EOA — so the smart account must
 * hold USDC.E, and the new vault is owned by the smart account.
 */
export function useGaslessDeposit() {
  const { client } = useSmartWallets();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<GaslessDepositResult | null>(null);

  const smartAccountAddress = client?.account?.address as `0x${string}` | undefined;
  const isReady = !!client;

  const gaslessDeposit = useCallback(
    async (tier: number, depositAmount: string): Promise<GaslessDepositResult | undefined> => {
      if (!client) {
        setError(new Error("Smart wallet not ready"));
        return undefined;
      }
      setIsPending(true);
      setError(null);
      setResult(null);
      try {
        const amount = parseUnits(depositAmount, 6);
        const approveData = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [VAULT_FACTORY_ADDRESS, amount],
        });
        const createData = encodeFunctionData({
          abi: VAULT_FACTORY_ABI,
          functionName: "createVaultAndDeposit",
          args: [tier, amount],
        });

        // One signature → one sponsored UserOp containing both calls.
        const txHash = (await client.sendTransaction({
          calls: [
            { to: BASE_TOKEN_ADDRESS, data: approveData },
            { to: VAULT_FACTORY_ADDRESS, data: createData },
          ],
        })) as Hex;

        // Resolve the created vault address from the receipt for redirect.
        let vault: `0x${string}` | null = null;
        try {
          const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
          for (const log of receipt.logs) {
            try {
              const decoded = decodeEventLog({
                abi: VAULT_FACTORY_ABI,
                data: log.data,
                topics: log.topics,
              });
              if (decoded.eventName === "VaultCreated") {
                vault = (decoded.args as { vault: `0x${string}` }).vault;
                break;
              }
            } catch {
              // not the VaultCreated event — skip
            }
          }
        } catch {
          // receipt lookup is best-effort; the tx may still have succeeded
        }

        const out = { txHash, vault };
        setResult(out);
        return out;
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
        return undefined;
      } finally {
        setIsPending(false);
      }
    },
    [client],
  );

  return { gaslessDeposit, isPending, error, result, smartAccountAddress, isReady };
}
