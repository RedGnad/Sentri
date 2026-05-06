// 0G network configuration. HackQuest asks for mainnet proof, while Galileo
// remains useful for rehearsals. Set SENTRI_NETWORK=mainnet to target 16661.

const NETWORK = process.env.SENTRI_NETWORK ?? process.env.NEXT_PUBLIC_SENTRI_NETWORK ?? "galileo";

const NETWORKS = {
  galileo: {
    id: 16602,
    name: "0G Galileo Testnet",
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    explorerUrl: "https://chainscan-galileo.0g.ai",
    indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
    flowContract: "0x22E03a6A89B950F1c82ec5e74F8eCa321a105296",
    storageSubmitFeeWei: "1000000000000000",
  },
  mainnet: {
    id: 16661,
    name: "0G Mainnet",
    rpcUrl: "https://evmrpc.0g.ai",
    explorerUrl: "https://chainscan.0g.ai",
    indexerUrl: "https://indexer-storage-turbo.0g.ai",
    flowContract: "0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526",
    storageSubmitFeeWei: "0",
  },
} as const;

const selectedNetwork = NETWORK === "mainnet" ? NETWORKS.mainnet : NETWORKS.galileo;

export const CHAIN = {
  id: selectedNetwork.id,
  name: selectedNetwork.name,
  rpcUrl: process.env.RPC_URL ?? selectedNetwork.rpcUrl,
  explorerUrl: process.env.EXPLORER_URL ?? selectedNetwork.explorerUrl,
  currency: { name: "OG", symbol: "OG", decimals: 18 },
} as const;

export const STORAGE = {
  indexerUrl: process.env.STORAGE_INDEXER_URL ?? selectedNetwork.indexerUrl,
  flowContract: process.env.STORAGE_FLOW_CONTRACT ?? selectedNetwork.flowContract,
  submitFeeWei: BigInt(process.env.STORAGE_SUBMIT_FEE_WEI ?? selectedNetwork.storageSubmitFeeWei),
} as const;

const GALILEO_CONTRACTS = {
  vaultFactory: "0x8a94F377De5450269e2035C8fAE31dE1E181F10e",
  vaultImplementation: "0x2A33268CbB4a5639063331Db94FD94a8426765C0",
  agentINFT: "0x1181A8670d5CA9597D60fEf2A571a14C58F33020",
  swapRouter: "0xD58b37C4d838aad5E0734ba3F0d34DFA34186d7C",
  swapPair: "0x0BeC7F13a4E9DAc95954EcdF3FF2DABd8279700f",
  priceFeed: "0x0e75243d34E904Ab925064c8297b36484Ce2aB5E",
  baseToken: "0xAcd0cc301eB160aA8C19B02a9Fac9a1967A69bE3",
  riskToken: "0x246e6080D736A217C151C3b88890C08e2C249d5E",
  demoVault: "0x5Aa3a7083915F6213238fc8c7461be969d5504e2",
} as const;

const MAINNET_CONTRACTS = {
  vaultFactory: "0x1794AADef202E0f39494D27491752B06c0CC26BC",
  vaultImplementation: "0x539ad624e9Be34db7369C6ee0fB22A6dF01C7BEE",
  agentINFT: "0x83C375F3808efAB339276E98C20dddfa69Af3659",
  swapRouter: "0x27647dB3F250EF843BAa7d06F50Bb2648F34c1E2",
  swapPair: "0xa9e824Eddb9677fB2189AB9c439238A83695C091",
  priceFeed: "0x13a37CC2D39B9615A7e0B773f869AD3998dba0b6",
  baseToken: "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E",
  riskToken: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c",
  demoVault: "0x87dA9a9A5fC6aA33a3379C026482704c41ECc676",
} as const;

const selectedContracts = NETWORK === "mainnet" ? MAINNET_CONTRACTS : GALILEO_CONTRACTS;

// ethers v6 throws on mixed-case addresses with an invalid EIP-55 checksum.
// We normalise everything we read from env to lowercase, which ethers accepts
// without checksum validation. Source defaults are written in proper EIP-55
// for readability.
function normalizeAddress(value: string | undefined): string | undefined {
  return value ? value.toLowerCase() : value;
}

// Contract addresses. The VaultFactory is the public entry point; users create
// vaults via it. All other addresses are immutable dependencies the factory
// wires into each new clone.
//
// Token addresses accept both the new BASE_TOKEN/RISK_TOKEN env names and the
// legacy MOCK_USDC/MOCK_WETH names (kept for compat with un-migrated env files
// and Render config).
export const CONTRACTS = {
  vaultFactory: normalizeAddress(process.env.NEXT_PUBLIC_VAULT_FACTORY_ADDRESS) ?? selectedContracts.vaultFactory,
  vaultImplementation: normalizeAddress(process.env.NEXT_PUBLIC_VAULT_IMPLEMENTATION_ADDRESS) ?? selectedContracts.vaultImplementation,
  agentINFT: normalizeAddress(process.env.NEXT_PUBLIC_AGENT_INFT_ADDRESS) ?? selectedContracts.agentINFT,
  swapRouter: normalizeAddress(process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS) ?? selectedContracts.swapRouter,
  swapPair: normalizeAddress(process.env.NEXT_PUBLIC_SWAP_PAIR_ADDRESS) ?? selectedContracts.swapPair,
  priceFeed: normalizeAddress(process.env.NEXT_PUBLIC_PRICE_FEED_ADDRESS) ?? selectedContracts.priceFeed,
  baseToken:
    normalizeAddress(process.env.NEXT_PUBLIC_BASE_TOKEN_ADDRESS)
    ?? normalizeAddress(process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS)
    ?? selectedContracts.baseToken,
  riskToken:
    normalizeAddress(process.env.NEXT_PUBLIC_RISK_TOKEN_ADDRESS)
    ?? normalizeAddress(process.env.NEXT_PUBLIC_MOCK_WETH_ADDRESS)
    ?? selectedContracts.riskToken,
  demoVault: normalizeAddress(process.env.NEXT_PUBLIC_DEMO_VAULT_ADDRESS) ?? selectedContracts.demoVault,
} as const;

// Agent loop timing
export const AGENT = {
  loopIntervalMs: 60_000,        // legacy single-vault interval (CLI)
  cycleIntervalMs: 5 * 60_000,   // multi-vault cycle interval (server)
  cooldownPeriodS: 300,
} as const;

// VaultFactory ABI — minimal subset the agent needs for vault discovery
// and the dashboard needs for the deploy wizard.
export const VAULT_FACTORY_ABI = [
  "function vaultsCount() external view returns (uint256)",
  "function allVaults(uint256) external view returns (address)",
  "function vaultsByOwner(address) external view returns (address[])",
  "function vaultsByOwnerCount(address) external view returns (uint256)",
  "function vaultsPage(uint256 start, uint256 limit) external view returns (address[])",
  "function previewPresetPolicy(uint8 tier) external pure returns (tuple(uint16 maxAllocationBps, uint16 maxDrawdownBps, uint16 rebalanceThresholdBps, uint16 maxSlippageBps, uint32 cooldownPeriod, uint32 maxPriceStaleness))",
  "function createVault(uint8 tier) external returns (address)",
  "function createVaultWithCustomPolicy(tuple(uint16 maxAllocationBps, uint16 maxDrawdownBps, uint16 rebalanceThresholdBps, uint16 maxSlippageBps, uint32 cooldownPeriod, uint32 maxPriceStaleness) policy) external returns (address)",
  "function createVaultAndDeposit(uint8 tier, uint256 depositAmount) external returns (address)",
  "function createVaultWithCustomPolicyAndDeposit(tuple(uint16 maxAllocationBps, uint16 maxDrawdownBps, uint16 rebalanceThresholdBps, uint16 maxSlippageBps, uint32 cooldownPeriod, uint32 maxPriceStaleness) policy, uint256 depositAmount) external returns (address)",
  "function implementation() external view returns (address)",
  "function agent() external view returns (address)",
  "function agentNFT() external view returns (address)",
  "function router() external view returns (address)",
  "function priceFeed() external view returns (address)",
  "function base() external view returns (address)",
  "function risk() external view returns (address)",
  "event VaultCreated(address indexed owner, address indexed vault, uint8 tier, tuple(uint16 maxAllocationBps, uint16 maxDrawdownBps, uint16 rebalanceThresholdBps, uint16 maxSlippageBps, uint32 cooldownPeriod, uint32 maxPriceStaleness) policy, uint256 indexed index)",
] as const;

// TreasuryVault ABI — matches Phase 1 init-pattern contract
export const TREASURY_VAULT_ABI = [
  "function deposit(uint256 amount) external",
  "function depositFrom(address payer, uint256 amount) external",
  "function withdraw(address to, uint256 amount) external",
  "function executeStrategy(uint8 action, uint256 amountIn, bytes32 intentHash, string signedResponse, bytes teeSignature, bytes32 teeAttestation, uint256 deadline) external",
  "function emergencyWithdraw() external",
  "function emergencyDeleverageAndWithdraw(uint256 minBaseOut) external",
  "function pause() external",
  "function unpause() external",
  "function setPolicy(tuple(uint16 maxAllocationBps, uint16 maxDrawdownBps, uint16 rebalanceThresholdBps, uint16 maxSlippageBps, uint32 cooldownPeriod, uint32 maxPriceStaleness) _policy) external",
  "function setAgent(address _agent) external",
  "function transferOwnership(address newOwner) external",
  "function acceptOwnership() external",
  "function vaultBalance() external view returns (uint256)",
  "function riskBalance() external view returns (uint256)",
  "function totalValue() external view returns (uint256)",
  "function highWaterMark() external view returns (uint256)",
  "function executionLogCount() external view returns (uint256)",
  "function executionLogs(uint256 index) external view returns (uint256 timestamp, uint8 action, uint256 amountIn, uint256 amountOut, uint256 tvlAfter, bytes32 intentHash, bytes32 responseHash, address teeSigner, bytes32 teeAttestation, uint256 deadline)",
  "function policy() external view returns (uint16 maxAllocationBps, uint16 maxDrawdownBps, uint16 rebalanceThresholdBps, uint16 maxSlippageBps, uint32 cooldownPeriod, uint32 maxPriceStaleness)",
  "function agent() external view returns (address)",
  "function killed() external view returns (bool)",
  "function paused() external view returns (bool)",
  "function base() external view returns (address)",
  "function risk() external view returns (address)",
  "function owner() external view returns (address)",
  "function pendingOwner() external view returns (address)",
  "function lastExecutionTime() external view returns (uint256)",
] as const;

export const PRICE_FEED_ABI = [
  "function pushAnswer(int256 answer, bytes32 attestation) external",
  "function latestAnswer() external view returns (int256)",
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
  "function keepers(address) external view returns (bool)",
] as const;

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function mint(address to, uint256 amount) external",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
] as const;
