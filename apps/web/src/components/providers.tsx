"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { config, privyWagmiConfig, privyConfig } from "@/config/wagmi";
import {
  PrivyActiveAccountProvider,
  WagmiActiveAccountProvider,
} from "@/hooks/use-active-account";

const queryClient = new QueryClient();

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function Providers({ children }: { children: React.ReactNode }) {
  // Privy path (email/social sign-in + embedded wallet) activates only when an
  // App ID is configured. Until then the app runs on the original wallet-only
  // stack, so the existing injected / WalletConnect flow is fully preserved and
  // nothing breaks before the Privy app is provisioned.
  if (privyAppId) {
    return (
      <PrivyProvider appId={privyAppId} config={privyConfig}>
        <SmartWalletsProvider>
          <QueryClientProvider client={queryClient}>
            <PrivyWagmiProvider config={privyWagmiConfig}>
              <PrivyActiveAccountProvider>{children}</PrivyActiveAccountProvider>
            </PrivyWagmiProvider>
          </QueryClientProvider>
        </SmartWalletsProvider>
      </PrivyProvider>
    );
  }

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <WagmiActiveAccountProvider>{children}</WagmiActiveAccountProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
