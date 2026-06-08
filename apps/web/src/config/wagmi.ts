"use client";

import { http, createConfig } from "wagmi";
import { createConfig as createPrivyWagmiConfig } from "@privy-io/wagmi";
import { defineChain } from "viem";
import { injected, walletConnect } from "wagmi/connectors";
import type { PrivyClientConfig } from "@privy-io/react-auth";

const selectedRpc =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (process.env.NEXT_PUBLIC_SENTRI_NETWORK === "mainnet"
    ? "https://evmrpc.0g.ai"
    : "https://evmrpc-testnet.0g.ai");
const selectedExplorer =
  process.env.NEXT_PUBLIC_EXPLORER_URL ??
  (process.env.NEXT_PUBLIC_SENTRI_NETWORK === "mainnet"
    ? "https://chainscan.0g.ai"
    : "https://chainscan-galileo.0g.ai");

export const galileo = defineChain({
  id: process.env.NEXT_PUBLIC_SENTRI_NETWORK === "mainnet" ? 16661 : 16602,
  name: process.env.NEXT_PUBLIC_SENTRI_NETWORK === "mainnet" ? "0G Mainnet" : "0G Galileo Testnet",
  nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
  rpcUrls: {
    default: { http: [selectedRpc] },
  },
  blockExplorers: {
    default: { name: "0G Explorer", url: selectedExplorer },
  },
  // Multicall3 is deployed at the canonical address on 0G (verified mainnet +
  // testnet). Declaring it lets wagmi aggregate every `useReadContracts` batch
  // into a single eth_call instead of one HTTP request per read — the audit
  // page alone drops from ~50 round-trips to one.
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: process.env.NEXT_PUBLIC_SENTRI_NETWORK !== "mainnet",
});

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// `batch: true` coalesces independent reads (e.g. the tier-detection probe and
// unrelated queries) into a single JSON-RPC batch POST. 0G RPC supports it.
const transports = {
  [16602]: http(galileo.id === 16602 ? selectedRpc : "https://evmrpc-testnet.0g.ai", { batch: true }),
  [16661]: http(galileo.id === 16661 ? selectedRpc : "https://evmrpc.0g.ai", { batch: true }),
};

// Wallet-only config (original behaviour). Used as the fallback provider stack
// when no Privy App ID is configured, so the app keeps running without Privy and
// the existing injected / WalletConnect flow stays fully intact.
export const config = createConfig({
  chains: [galileo],
  connectors: [
    injected(),
    ...(projectId ? [walletConnect({ projectId, showQrModal: false })] : []),
  ],
  transports,
  ssr: true,
  multiInjectedProviderDiscovery: true,
});

// Privy-managed wagmi config. No connectors here on purpose: Privy injects the
// embedded wallet (email/social sign-in) plus any external wallet connected
// through its login modal, and bridges them to wagmi. createConfig is imported
// from @privy-io/wagmi (not wagmi) so the embedded wallet is wired correctly.
export const privyWagmiConfig = createPrivyWagmiConfig({
  chains: [galileo],
  transports,
  ssr: true,
});

// PrivyProvider client config. Email-first for web2 onboarding; an embedded
// wallet is created for users who sign in without one. Pinned to 0G as the only
// chain. Visual theming is kept minimal here and refined with the consumer mockups.
export const privyConfig: PrivyClientConfig = {
  defaultChain: galileo,
  supportedChains: [galileo],
  loginMethods: ["email", "wallet"],
  embeddedWallets: {
    ethereum: { createOnLogin: "users-without-wallets" },
    showWalletUIs: true,
  },
  appearance: { theme: "dark" },
};
