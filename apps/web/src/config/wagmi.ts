"use client";

import { http } from "wagmi";
import { defineChain } from "viem";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

export const galileo = defineChain({
  id: 80087,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://evmrpc-testnet.0g.ai"] },
  },
  blockExplorers: {
    default: { name: "0G Explorer", url: "https://chainscan-galileo.0g.ai" },
  },
  testnet: true,
});

export const config = getDefaultConfig({
  appName: "Sentri",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "sentri-demo",
  chains: [galileo],
  transports: {
    [galileo.id]: http("https://evmrpc-testnet.0g.ai"),
  },
  ssr: true,
});
