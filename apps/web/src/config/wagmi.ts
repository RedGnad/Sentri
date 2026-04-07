"use client";

import { http, createConfig } from "wagmi";
import { defineChain } from "viem";
import { injected, coinbaseWallet, safe } from "wagmi/connectors";

export const galileo = defineChain({
  id: 16602,
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

export const config = createConfig({
  chains: [galileo],
  connectors: [
    injected(),
    coinbaseWallet({ appName: "Sentri" }),
    safe(),
  ],
  transports: {
    [galileo.id]: http("https://evmrpc-testnet.0g.ai"),
  },
  ssr: true,
});
