"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";

// Single source of truth for the user's on-chain identity.
//
// In gasless (Privy) mode this is the SMART ACCOUNT — the address that owns
// vaults, holds funds, and sends sponsored transactions. The whole app (My
// Vaults, balances, ownership checks, deposits) must key off THIS, not wagmi's
// useAccount(), which can surface a leftover injected browser wallet and make
// everything incoherent (e.g. showing another wallet's vaults).
//
// In wallet-only mode (no Privy app id) it's simply the connected wagmi account.

const ActiveAccountContext = createContext<`0x${string}` | undefined>(undefined);

export function useActiveAddress(): `0x${string}` | undefined {
  return useContext(ActiveAccountContext);
}

/** Privy/gasless mode: smart account, falling back to the embedded wallet while
 *  the smart account provisions. Never the (possibly injected) wagmi account. */
export function PrivyActiveAccountProvider({ children }: { children: ReactNode }) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { client } = useSmartWallets();
  const smart = client?.account?.address as `0x${string}` | undefined;
  const embedded = (wallets.find((w) => w.walletClientType === "privy")?.address ??
    user?.wallet?.address) as `0x${string}` | undefined;
  return (
    <ActiveAccountContext.Provider value={smart ?? embedded}>
      {children}
    </ActiveAccountContext.Provider>
  );
}

/** Wallet-only fallback: the connected wagmi account. */
export function WagmiActiveAccountProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  return (
    <ActiveAccountContext.Provider value={address}>
      {children}
    </ActiveAccountContext.Provider>
  );
}
