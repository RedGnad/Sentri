// 0G mainnet real-asset profile.
//
// Galileo uses MockUSDC/MockWETH and SentriPair so the full TEE -> vault ->
// swap -> Storage loop is deterministic for review. The production 0G asset
// model should use bridged USDC (USDC.E) as the base asset and W0G as the risk
// asset through a real venue such as Jaine.
//
// Keep these addresses environment-provided until the final token, router, and
// pool addresses are verified from primary sources before mainnet deployment.

export const ZERO_G_MAINNET_REAL_ASSET_PROFILE = {
  chainId: 16661,
  base: {
    symbol: "USDC.E",
    label: "XSwap Bridged USDC on 0G",
    kind: "bridged-stablecoin",
    address: process.env.ZERO_G_MAINNET_USDCE_ADDRESS ?? "",
    decimals: 6,
    riskNote: "Bridged USDC carries bridge and liquidity risk; it is not native Circle-issued USDC.",
  },
  risk: {
    symbol: "W0G",
    label: "Wrapped 0G",
    kind: "wrapped-native",
    address: process.env.ZERO_G_MAINNET_W0G_ADDRESS ?? "",
    decimals: 18,
  },
  venue: {
    name: "Jaine",
    router: process.env.ZERO_G_MAINNET_JAINE_ROUTER_ADDRESS ?? "",
    usdceW0gPool: process.env.ZERO_G_MAINNET_JAINE_USDCE_W0G_POOL_ADDRESS ?? "",
    feeTierBps: 30,
  },
} as const;
