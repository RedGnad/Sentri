// 0G mainnet real-asset profile.
//
// Galileo uses MockUSDC/MockWETH and SentriPair so the full TEE -> vault ->
// swap -> Storage loop is deterministic for review. The production 0G asset
// model should use bridged USDC (USDC.E) as the base asset and W0G as the risk
// asset through a real venue such as Jaine.
//
// Defaults below are the public USDC.E/W0G Jaine pool observed on 0G mainnet;
// keep env overrides available so we can rotate to a newer/higher-liquidity
// pool before final deployment if needed.

export const ZERO_G_MAINNET_DEFAULTS = {
  USDC_E: "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E",
  W0G: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c",
  JAINE_USDCE_W0G_POOL: "0xa9e824Eddb9677fB2189AB9c439238A83695C091",
} as const;

export const ZERO_G_MAINNET_REAL_ASSET_PROFILE = {
  chainId: 16661,
  base: {
    symbol: "USDC.E",
    label: "XSwap Bridged USDC on 0G",
    kind: "bridged-stablecoin",
    address: process.env.ZERO_G_MAINNET_USDCE_ADDRESS ?? ZERO_G_MAINNET_DEFAULTS.USDC_E,
    decimals: 6,
    riskNote: "Bridged USDC carries bridge and liquidity risk; it is not native Circle-issued USDC.",
  },
  risk: {
    symbol: "W0G",
    label: "Wrapped 0G",
    kind: "wrapped-native",
    address: process.env.ZERO_G_MAINNET_W0G_ADDRESS ?? ZERO_G_MAINNET_DEFAULTS.W0G,
    decimals: 18,
  },
  venue: {
    name: "Jaine",
    adapter: process.env.ZERO_G_MAINNET_JAINE_ADAPTER_ADDRESS ?? "",
    usdceW0gPool: process.env.ZERO_G_MAINNET_JAINE_USDCE_W0G_POOL_ADDRESS ??
      ZERO_G_MAINNET_DEFAULTS.JAINE_USDCE_W0G_POOL,
    feeTierBps: 30,
  },
} as const;
