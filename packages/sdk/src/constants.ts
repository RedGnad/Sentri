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
  },
  mainnet: {
    id: 16661,
    name: "0G Mainnet",
    rpcUrl: "https://evmrpc.0g.ai",
    explorerUrl: "https://chainscan.0g.ai",
    indexerUrl: "https://indexer-storage-turbo.0g.ai",
    flowContract: "0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526",
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
} as const;

// Contract addresses — Phase 1 multi-tenant deployment on Galileo (May 2026).
// The VaultFactory is the public entry point; users create vaults via it.
// All other addresses are immutable dependencies the factory wires into each
// new clone.
export const CONTRACTS = {
  vaultFactory: process.env.NEXT_PUBLIC_VAULT_FACTORY_ADDRESS ?? "0xE3cfFc08a8327b7464168a4C17D5AE609bE75153",
  vaultImplementation: process.env.NEXT_PUBLIC_VAULT_IMPLEMENTATION_ADDRESS ?? "0x7fDfbee09665fffEB150F500C2CC8326c87B6304",
  agentINFT: process.env.NEXT_PUBLIC_AGENT_INFT_ADDRESS ?? "0x3E74C5820e3DF83C331AC058328Dd18C037E151F",
  swapRouter: process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS ?? "0x13173a0F2BB4687F8b601374566649559511D512",
  swapPair: process.env.NEXT_PUBLIC_SWAP_PAIR_ADDRESS ?? "0x1C8040c84344641cA4ab3CAE44c2B99c9ec1f137",
  priceFeed: process.env.NEXT_PUBLIC_PRICE_FEED_ADDRESS ?? "0xaDb52a49d0398cA048f4027Fe81748Dd666BAfF8",
  mockUSDC: process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS ?? "0x93cA5b6fEA5328FAa0ed4B6Cb6a2E82339558792",
  mockWETH: process.env.NEXT_PUBLIC_MOCK_WETH_ADDRESS ?? "0xF25A225562808a00776aAAD4DFC98c6B48Ad5790",
  demoVault: process.env.NEXT_PUBLIC_DEMO_VAULT_ADDRESS ?? "0x435946204b818e82C97362F21Ca8B967F5266F83",
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
