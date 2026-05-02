import { type Abi } from "viem";

// Replay-protected multi-tenant deployment on Galileo testnet (May 2026).
// VaultFactory is the public entry point; users create their own vaults via it.
// Set NEXT_PUBLIC_SENTRI_NETWORK=mainnet and override addresses after the
// required 0G mainnet deployment for HackQuest review.

export const VAULT_FACTORY_ADDRESS =
  (process.env.NEXT_PUBLIC_VAULT_FACTORY_ADDRESS as `0x${string}`) ??
  "0x3DBc323A0540EB104df2C73f30a12CE2881a98aa";

export const AGENT_INFT_ADDRESS =
  (process.env.NEXT_PUBLIC_AGENT_INFT_ADDRESS as `0x${string}`) ??
  "0x1181A8670d5CA9597D60fEf2A571a14C58F33020";

export const SWAP_ROUTER_ADDRESS =
  (process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS as `0x${string}`) ??
  "0xD58b37C4d838aad5E0734ba3F0d34DFA34186d7C";

export const PRICE_FEED_ADDRESS =
  (process.env.NEXT_PUBLIC_PRICE_FEED_ADDRESS as `0x${string}`) ??
  "0x0e75243d34E904Ab925064c8297b36484Ce2aB5E";

export const MOCK_USDC_ADDRESS =
  (process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS as `0x${string}`) ??
  "0xAcd0cc301eB160aA8C19B02a9Fac9a1967A69bE3";

export const MOCK_WETH_ADDRESS =
  (process.env.NEXT_PUBLIC_MOCK_WETH_ADDRESS as `0x${string}`) ??
  "0x246e6080D736A217C151C3b88890C08e2C249d5E";

export const DEMO_VAULT_ADDRESS =
  (process.env.NEXT_PUBLIC_DEMO_VAULT_ADDRESS as `0x${string}`) ??
  "0xB6539EC33a360726ac7E8f053327022AC891E86D";

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
    bullets: ["15% max WETH exposure", "2% drawdown freeze", "0.5% slippage cap", "10 min cooldown"],
  },
  1: {
    name: "Balanced",
    description: "Standard DAO treasury. Productive but bounded.",
    bullets: ["30% max WETH exposure", "5% drawdown freeze", "1% slippage cap", "5 min cooldown"],
  },
  2: {
    name: "Aggressive",
    description: "Protocol with appetite for productive risk.",
    bullets: ["50% max WETH exposure", "10% drawdown freeze", "2% slippage cap", "3 min cooldown"],
  },
  3: {
    name: "Custom",
    description: "Set your own bounded parameters.",
    bullets: ["≤ 50% WETH exposure", "≤ 20% drawdown", "≤ 5% slippage", "≥ 60s cooldown"],
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
