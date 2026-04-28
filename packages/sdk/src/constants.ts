// 0G Galileo Testnet Configuration

export const CHAIN = {
  id: 16602,
  name: "0G Galileo Testnet",
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  explorerUrl: "https://chainscan-galileo.0g.ai",
  currency: { name: "OG", symbol: "OG", decimals: 18 },
} as const;

export const STORAGE = {
  indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
  flowContract: "0x22E03a6A89B950F1c82ec5e74F8eCa321a105296",
} as const;

// Contract addresses — populated after deployment
export const CONTRACTS = {
  mockUSDC: process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS ?? "",
  mockWETH: process.env.NEXT_PUBLIC_MOCK_WETH_ADDRESS ?? "",
  treasuryVault: process.env.NEXT_PUBLIC_TREASURY_VAULT_ADDRESS ?? "",
  priceFeed: process.env.NEXT_PUBLIC_PRICE_FEED_ADDRESS ?? "",
  swapRouter: process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS ?? "",
  agentINFT: process.env.NEXT_PUBLIC_AGENT_INFT_ADDRESS ?? "",
} as const;

// Agent loop timing
export const AGENT = {
  loopIntervalMs: 60_000,
  cooldownPeriodS: 300,
} as const;

// TreasuryVault ABI — matches current contract (v2 with real swaps)
export const TREASURY_VAULT_ABI = [
  "function deposit(uint256 amount) external",
  "function withdraw(address to, uint256 amount) external",
  "function executeStrategy(uint8 action, uint256 amountIn, bytes32 proofHash, bytes32 teeAttestation) external",
  "function emergencyWithdraw() external",
  "function pause() external",
  "function unpause() external",
  "function setPolicy(tuple(uint16 maxAllocationBps, uint16 maxDrawdownBps, uint16 rebalanceThresholdBps, uint16 maxSlippageBps, uint32 cooldownPeriod, uint32 maxPriceStaleness) _policy) external",
  "function setAgent(address _agent) external",
  "function vaultBalance() external view returns (uint256)",
  "function riskBalance() external view returns (uint256)",
  "function totalValue() external view returns (uint256)",
  "function highWaterMark() external view returns (uint256)",
  "function executionLogCount() external view returns (uint256)",
  "function executionLogs(uint256 index) external view returns (uint256 timestamp, uint8 action, uint256 amountIn, uint256 amountOut, uint256 tvlAfter, bytes32 proofHash, bytes32 teeAttestation)",
  "function policy() external view returns (uint16 maxAllocationBps, uint16 maxDrawdownBps, uint16 rebalanceThresholdBps, uint16 maxSlippageBps, uint32 cooldownPeriod, uint32 maxPriceStaleness)",
  "function agent() external view returns (address)",
  "function killed() external view returns (bool)",
  "function paused() external view returns (bool)",
  "function base() external view returns (address)",
  "function risk() external view returns (address)",
  "function owner() external view returns (address)",
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
