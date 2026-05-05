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
  vaultFactory: "0x3DBc323A0540EB104df2C73f30a12CE2881a98aa",
  vaultImplementation: "0xf4bE6A5ead857F5927490418F2903F8Cc88533d6",
  agentINFT: "0x1181A8670d5CA9597D60fEf2A571a14C58F33020",
  swapRouter: "0xD58b37C4d838aad5E0734ba3F0d34DFA34186d7C",
  swapPair: "0x0BeC7F13a4E9DAc95954EcdF3FF2DABd8279700f",
  priceFeed: "0x0e75243d34E904Ab925064c8297b36484Ce2aB5E",
  mockUSDC: "0xAcd0cc301eB160aA8C19B02a9Fac9a1967A69bE3",
  mockWETH: "0x246e6080D736A217C151C3b88890C08e2C249d5E",
  demoVault: "0xB6539EC33a360726ac7E8f053327022AC891E86D",
} as const;

const MAINNET_CONTRACTS = {
  vaultFactory: "0xF62E401bE84e099CE3F00e3F193960Eb295259D8",
  vaultImplementation: "0x7eCA98adb3EE5Bd11e09Cf4cb04d9ceF4914c7b0",
  agentINFT: "0xb921613c9F71c1B5191F6619e8252CD83Fcc59EC",
  swapRouter: "0x4A85187939E56071F05a38633F54CFf8d39c295C",
  swapPair: "0xa9e824Eddb9677fB2189AB9c439238A83695C091",
  priceFeed: "0xBe3B15de061BE593086c48268f662Cc4c7001E07",
  mockUSDC: "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E",
  mockWETH: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c",
  demoVault: "0xb503E945a70fD4F7ADDFd0dcd6B2CB0b9a08Ba5f",
} as const;

const selectedContracts = NETWORK === "mainnet" ? MAINNET_CONTRACTS : GALILEO_CONTRACTS;

// Contract addresses. The VaultFactory is the public entry point; users create
// vaults via it. All other addresses are immutable dependencies the factory
// wires into each new clone.
export const CONTRACTS = {
  vaultFactory: process.env.NEXT_PUBLIC_VAULT_FACTORY_ADDRESS ?? selectedContracts.vaultFactory,
  vaultImplementation: process.env.NEXT_PUBLIC_VAULT_IMPLEMENTATION_ADDRESS ?? selectedContracts.vaultImplementation,
  agentINFT: process.env.NEXT_PUBLIC_AGENT_INFT_ADDRESS ?? selectedContracts.agentINFT,
  swapRouter: process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS ?? selectedContracts.swapRouter,
  swapPair: process.env.NEXT_PUBLIC_SWAP_PAIR_ADDRESS ?? selectedContracts.swapPair,
  priceFeed: process.env.NEXT_PUBLIC_PRICE_FEED_ADDRESS ?? selectedContracts.priceFeed,
  mockUSDC: process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS ?? selectedContracts.mockUSDC,
  mockWETH: process.env.NEXT_PUBLIC_MOCK_WETH_ADDRESS ?? selectedContracts.mockWETH,
  demoVault: process.env.NEXT_PUBLIC_DEMO_VAULT_ADDRESS ?? selectedContracts.demoVault,
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
