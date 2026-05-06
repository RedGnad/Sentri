import { type Abi } from "viem";

// Replay-protected multi-tenant deployment on Galileo testnet (May 2026).
// VaultFactory is the public entry point; users create their own vaults via it.
// Set NEXT_PUBLIC_SENTRI_NETWORK=mainnet and override addresses after the
// required 0G mainnet deployment for HackQuest review.

export const SENTRI_NETWORK = process.env.NEXT_PUBLIC_SENTRI_NETWORK ?? "galileo";
export const IS_MAINNET = SENTRI_NETWORK === "mainnet";
export const BASE_SYMBOL = process.env.NEXT_PUBLIC_BASE_SYMBOL ?? (IS_MAINNET ? "USDC.E" : "USDC");
export const RISK_SYMBOL = process.env.NEXT_PUBLIC_RISK_SYMBOL ?? (IS_MAINNET ? "W0G" : "WETH");

const GALILEO_CONTRACTS = {
  vaultFactory: "0x8a94F377De5450269e2035C8fAE31dE1E181F10e",
  agentINFT: "0x1181A8670d5CA9597D60fEf2A571a14C58F33020",
  swapRouter: "0xD58b37C4d838aad5E0734ba3F0d34DFA34186d7C",
  priceFeed: "0x0e75243d34E904Ab925064c8297b36484Ce2aB5E",
  baseToken: "0xAcd0cc301eB160aA8C19B02a9Fac9a1967A69bE3",
  riskToken: "0x246e6080D736A217C151C3b88890C08e2C249d5E",
  demoVault: "0x5Aa3a7083915F6213238fc8c7461be969d5504e2",
} as const;

const MAINNET_CONTRACTS = {
  vaultFactory: "0x1794AADef202E0f39494D27491752B06c0CC26BC",
  agentINFT: "0x83C375F3808efAB339276E98C20dddfa69Af3659",
  swapRouter: "0x27647dB3F250EF843BAa7d06F50Bb2648F34c1E2",
  priceFeed: "0x13a37CC2D39B9615A7e0B773f869AD3998dba0b6",
  baseToken: "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E",
  riskToken: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c",
  demoVault: "0x87dA9a9A5fC6aA33a3379C026482704c41ECc676",
} as const;

const SELECTED_CONTRACTS = IS_MAINNET ? MAINNET_CONTRACTS : GALILEO_CONTRACTS;

// viem rejects mixed-case addresses with an invalid EIP-55 checksum. We
// lowercase whatever comes in from env (Vercel/Render dashboards routinely
// preserve whatever casing was pasted) so contract calls don't blow up just
// because someone copied an address with the wrong case mid-string.
function normalizeAddress(value: string | undefined): `0x${string}` | undefined {
  return value ? (value.toLowerCase() as `0x${string}`) : undefined;
}

export const VAULT_FACTORY_ADDRESS =
  normalizeAddress(process.env.NEXT_PUBLIC_VAULT_FACTORY_ADDRESS) ??
  (SELECTED_CONTRACTS.vaultFactory as `0x${string}`);

export const AGENT_INFT_ADDRESS =
  normalizeAddress(process.env.NEXT_PUBLIC_AGENT_INFT_ADDRESS) ??
  (SELECTED_CONTRACTS.agentINFT as `0x${string}`);

export const SWAP_ROUTER_ADDRESS =
  normalizeAddress(process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS) ??
  (SELECTED_CONTRACTS.swapRouter as `0x${string}`);

export const PRICE_FEED_ADDRESS =
  normalizeAddress(process.env.NEXT_PUBLIC_PRICE_FEED_ADDRESS) ??
  (SELECTED_CONTRACTS.priceFeed as `0x${string}`);

// Base stable asset token (USDC.E on mainnet, MockUSDC on Galileo).
// Reads NEXT_PUBLIC_BASE_TOKEN_ADDRESS first, falls back to legacy
// NEXT_PUBLIC_MOCK_USDC_ADDRESS for compat with un-migrated env files.
export const BASE_TOKEN_ADDRESS =
  normalizeAddress(process.env.NEXT_PUBLIC_BASE_TOKEN_ADDRESS) ??
  normalizeAddress(process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS) ??
  (SELECTED_CONTRACTS.baseToken as `0x${string}`);

// Risk asset token (W0G on mainnet, MockWETH on Galileo).
// Reads NEXT_PUBLIC_RISK_TOKEN_ADDRESS first, falls back to legacy
// NEXT_PUBLIC_MOCK_WETH_ADDRESS for compat.
export const RISK_TOKEN_ADDRESS =
  normalizeAddress(process.env.NEXT_PUBLIC_RISK_TOKEN_ADDRESS) ??
  normalizeAddress(process.env.NEXT_PUBLIC_MOCK_WETH_ADDRESS) ??
  (SELECTED_CONTRACTS.riskToken as `0x${string}`);

export const DEMO_VAULT_ADDRESS =
  normalizeAddress(process.env.NEXT_PUBLIC_DEMO_VAULT_ADDRESS) ??
  (SELECTED_CONTRACTS.demoVault as `0x${string}`);

// Preset tier enum mirrors VaultFactory.PresetTier solidity enum.
export const PresetTier = {
  Conservative: 0,
  Balanced: 1,
  Aggressive: 2,
  Custom: 3,
} as const;
export type PresetTierName = keyof typeof PresetTier;

export const PRESET_LABELS: Record<number, { name: PresetTierName; description: string; bullets: string[] }> = {
  0: {
    name: "Conservative",
    description: "Foundation-grade. Capital preservation first.",
    bullets: ["15% max risk exposure", "2% drawdown freeze", "0.5% slippage cap", "12h action spacing"],
  },
  1: {
    name: "Balanced",
    description: "Standard DAO treasury. Productive but bounded.",
    bullets: ["30% max risk exposure", "5% drawdown freeze", "1% slippage cap", "30 min action spacing"],
  },
  2: {
    name: "Aggressive",
    description: "Active rebalancer. Higher cadence, larger envelope.",
    bullets: ["50% max risk exposure", "10% drawdown freeze", "2% slippage cap", "60s action spacing"],
  },
  3: {
    name: "Custom",
    description: "Set your own bounded parameters.",
    bullets: ["≤ 50% risk exposure", "≤ 20% drawdown", "≤ 5% slippage", "≥ 60s min action spacing"],
  },
};

// ── ABIs ─────────────────────────────────────────────────────────────────

export const VAULT_FACTORY_ABI = [
  { type: "function", name: "vaultsCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "allVaults",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "vaultsByOwner",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "vaultsByOwnerCount",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "vaultsPage",
    inputs: [{ type: "uint256", name: "start" }, { type: "uint256", name: "limit" }],
    outputs: [{ type: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "previewPresetPolicy",
    inputs: [{ type: "uint8", name: "tier" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "maxAllocationBps", type: "uint16" },
          { name: "maxDrawdownBps", type: "uint16" },
          { name: "rebalanceThresholdBps", type: "uint16" },
          { name: "maxSlippageBps", type: "uint16" },
          { name: "cooldownPeriod", type: "uint32" },
          { name: "maxPriceStaleness", type: "uint32" },
        ],
      },
    ],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "createVault",
    inputs: [{ type: "uint8", name: "tier" }],
    outputs: [{ type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createVaultAndDeposit",
    inputs: [
      { type: "uint8", name: "tier" },
      { type: "uint256", name: "depositAmount" },
    ],
    outputs: [{ type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createVaultWithCustomPolicy",
    inputs: [
      {
        type: "tuple",
        name: "policy",
        components: [
          { name: "maxAllocationBps", type: "uint16" },
          { name: "maxDrawdownBps", type: "uint16" },
          { name: "rebalanceThresholdBps", type: "uint16" },
          { name: "maxSlippageBps", type: "uint16" },
          { name: "cooldownPeriod", type: "uint32" },
          { name: "maxPriceStaleness", type: "uint32" },
        ],
      },
    ],
    outputs: [{ type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createVaultWithCustomPolicyAndDeposit",
    inputs: [
      {
        type: "tuple",
        name: "policy",
        components: [
          { name: "maxAllocationBps", type: "uint16" },
          { name: "maxDrawdownBps", type: "uint16" },
          { name: "rebalanceThresholdBps", type: "uint16" },
          { name: "maxSlippageBps", type: "uint16" },
          { name: "cooldownPeriod", type: "uint32" },
          { name: "maxPriceStaleness", type: "uint32" },
        ],
      },
      { type: "uint256", name: "depositAmount" },
    ],
    outputs: [{ type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "VaultCreated",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "vault", type: "address", indexed: true },
      { name: "tier", type: "uint8", indexed: false },
      {
        name: "policy",
        type: "tuple",
        components: [
          { name: "maxAllocationBps", type: "uint16" },
          { name: "maxDrawdownBps", type: "uint16" },
          { name: "rebalanceThresholdBps", type: "uint16" },
          { name: "maxSlippageBps", type: "uint16" },
          { name: "cooldownPeriod", type: "uint32" },
          { name: "maxPriceStaleness", type: "uint32" },
        ],
        indexed: false,
      },
      { name: "index", type: "uint256", indexed: true },
    ],
  },
] as const satisfies Abi;

export const TREASURY_VAULT_ABI = [
  { type: "function", name: "deposit", inputs: [{ name: "amount", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  {
    type: "function",
    name: "withdraw",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeStrategy",
    inputs: [
      { name: "action", type: "uint8" },
      { name: "amountIn", type: "uint256" },
      { name: "intentHash", type: "bytes32" },
      { name: "signedResponse", type: "string" },
      { name: "teeSignature", type: "bytes" },
      { name: "teeAttestation", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { type: "function", name: "emergencyWithdraw", inputs: [], outputs: [], stateMutability: "nonpayable" },
  {
    type: "function",
    name: "emergencyDeleverageAndWithdraw",
    inputs: [{ name: "minBaseOut", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { type: "function", name: "pause", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "unpause", inputs: [], outputs: [], stateMutability: "nonpayable" },
  {
    type: "function",
    name: "setPolicy",
    inputs: [
      {
        name: "_policy",
        type: "tuple",
        components: [
          { name: "maxAllocationBps", type: "uint16" },
          { name: "maxDrawdownBps", type: "uint16" },
          { name: "rebalanceThresholdBps", type: "uint16" },
          { name: "maxSlippageBps", type: "uint16" },
          { name: "cooldownPeriod", type: "uint32" },
          { name: "maxPriceStaleness", type: "uint32" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { type: "function", name: "setAgent", inputs: [{ name: "_agent", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "vaultBalance", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "riskBalance", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalValue", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "highWaterMark", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "executionLogCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "executionLogs",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [
      { name: "timestamp", type: "uint256" },
      { name: "action", type: "uint8" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOut", type: "uint256" },
      { name: "tvlAfter", type: "uint256" },
      { name: "intentHash", type: "bytes32" },
      { name: "responseHash", type: "bytes32" },
      { name: "teeSigner", type: "address" },
      { name: "teeAttestation", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "policy",
    inputs: [],
    outputs: [
      { name: "maxAllocationBps", type: "uint16" },
      { name: "maxDrawdownBps", type: "uint16" },
      { name: "rebalanceThresholdBps", type: "uint16" },
      { name: "maxSlippageBps", type: "uint16" },
      { name: "cooldownPeriod", type: "uint32" },
      { name: "maxPriceStaleness", type: "uint32" },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "agent", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "killed", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "paused", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "base", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "risk", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "lastExecutionTime", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
] as const satisfies Abi;

export const PRICE_FEED_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const satisfies Abi;

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "mint", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const satisfies Abi;
