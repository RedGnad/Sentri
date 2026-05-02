"use client";

import { http, createConfig } from "wagmi";
import { defineChain } from "viem";
import { injected, coinbaseWallet, safe } from "wagmi/connectors";

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
  testnet: process.env.NEXT_PUBLIC_SENTRI_NETWORK !== "mainnet",
});

export const config = createConfig({
  chains: [galileo],
  connectors: [
    injected(),
    coinbaseWallet({ appName: "Sentri" }),
    safe(),
  ],
  transports: {
    [16602]: http(galileo.id === 16602 ? selectedRpc : "https://evmrpc-testnet.0g.ai"),
    [16661]: http(galileo.id === 16661 ? selectedRpc : "https://evmrpc.0g.ai"),
  },
  ssr: true,
});
