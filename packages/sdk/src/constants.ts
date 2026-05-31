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
  // KV node URL — must be overridden via STORAGE_KV_NODE_URL in production.
  kvNodeUrl: process.env.STORAGE_KV_NODE_URL ?? "http://3.101.147.150:6789",
} as const;

const GALILEO_CONTRACTS = {
  vaultFactory: "0x8a94F377De5450269e2035C8fAE31dE1E181F10e",
  // VaultFactoryV2 is mainnet-only today; empty string means "not configured"
  // and the V2 keeper batch is skipped regardless of SENTRI_ENABLE_V2_KEEPER.
  vaultFactoryV2: "",
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
  vaultFactory: "0x9EE0c94c87FaDeB6dFb619B2C429eC05bc623cc7",
  vaultFactoryV2: "0xA3588d1964F7CeCDcFac15e38D286554955CF58C",
  vaultImplementation: "0xf86013C68811047F6dEc98c4ED6601C80B720668",
  agentINFT: "0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951",
  swapRouter: "0xAdf55d5380f216F53f109B6B8341C9169BaeEBa4",
  swapPair: "0xa9e824Eddb9677fB2189AB9c439238A83695C091",
  priceFeed: "0x1289638A90da7F24DB069168648819607A7377e6",
  baseToken: "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E",
  riskToken: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c",
  demoVault: "0x20e8B2De8Ac2c8c5EE662Ea9986EC280FaebcA8E",
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
  // V2 factory — when empty (Galileo today, or env override unset on a network
  // where the V2 factory isn't deployed), the V2 keeper batch is skipped with a
  // log and never blocks V1.
  vaultFactoryV2:
    normalizeAddress(process.env.SENTRI_VAULT_FACTORY_V2_ADDRESS)
    ?? normalizeAddress(process.env.NEXT_PUBLIC_VAULT_FACTORY_V2_ADDRESS)
    ?? selectedContracts.vaultFactoryV2,
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

// V2 keeper batch defaults. Every field is overridable via env so the operator
// can flip the canary on/off without a redeploy. Defaults are deliberately
// conservative — flag OFF, no allowlist (empty = skip), generous OG floor.
export const V2_KEEPER = {
  /** Master flag. When false (default), the V2 batch is fully bypassed. */
  enabled: (process.env.SENTRI_ENABLE_V2_KEEPER ?? "false").toLowerCase() === "true",
  /**
   * Comma-separated 0x addresses. Vaults discovered by VaultFactoryV2 that are
   * NOT in this list are dropped. Empty list = no V2 work this cycle (warning
   * logged once per cycle). Lowercased on read.
   */
  allowlist: (process.env.SENTRI_V2_KEEPER_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s)),
  /**
   * Minimum operator OG balance (wei) before the V2 batch is allowed. The Pyth
   * pull fee is paid in native OG (~2e17 wei per exec). Default 0.5 OG leaves
   * headroom for the price push (V1) plus a few retries.
   */
  minOgWei: BigInt(process.env.SENTRI_V2_KEEPER_MIN_OG_WEI ?? "500000000000000000"),
  /**
   * Hard cap on the number of V2 vaults handled per cycle. Default 1: the
   * canary is the only allowlisted vault today, but this also caps the blast
   * radius if a future allowlist grows faster than the keeper is observed.
   */
  maxVaultsPerCycle: Number(process.env.SENTRI_V2_MAX_VAULTS_PER_CYCLE ?? "1"),
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
  "function agentTokenId() external view returns (uint256)",
  "function router() external view returns (address)",
  "function priceFeed() external view returns (address)",
  "function base() external view returns (address)",
  "function risk() external view returns (address)",
  "event VaultCreated(address indexed owner, address indexed vault, uint8 tier, tuple(uint16 maxAllocationBps, uint16 maxDrawdownBps, uint16 rebalanceThresholdBps, uint16 maxSlippageBps, uint32 cooldownPeriod, uint32 maxPriceStaleness) policy, uint256 indexed index)",
] as const;

// VaultFactoryV2 ABI — minimal subset for V2 vault discovery. The V2 factory
// uses `vaultCount()` (no trailing s) and `allVaults(uint256)` rather than the
// V1 paginated `vaultsPage(...)` helper, so the V2 keeper reads one address per
// call. Keep this small: the V2 keeper batch only needs to list addresses.
export const VAULT_FACTORY_V2_ABI = [
  "function vaultCount() external view returns (uint256)",
  "function allVaults(uint256) external view returns (address)",
] as const;

// TreasuryVaultTrustlessOracle (V2) — executionLogs() returns the same 10 standard
// fields as V1 PLUS three Pyth-proof fields (pythPrice, pythPublishTime,
// pythConfBps). The shared TREASURY_VAULT_ABI declares only the 10 V1 fields, so
// reading a V2 log via that ABI yields a Result of length 10 and any access at
// index 10/11/12 throws "out of result range" — exactly the post-tx crash that
// stranded V2 audit blobs in their pre-tx state. This dedicated 13-field ABI is
// used solely for the post-tx executionLogs read on V2 vaults; all other vault
// calls keep using TREASURY_VAULT_ABI.
export const TRUSTLESS_VAULT_EXECUTION_LOG_ABI = [
  "function executionLogs(uint256 index) external view returns (uint256 timestamp, uint8 action, uint256 amountIn, uint256 amountOut, uint256 tvlAfter, bytes32 intentHash, bytes32 responseHash, address teeSigner, bytes32 teeAttestation, uint256 deadline, uint256 pythPrice, uint256 pythPublishTime, uint256 pythConfBps)",
] as const;

// TreasuryVault ABI — matches Phase 1 init-pattern contract
export const TREASURY_VAULT_ABI = [
  "function deposit(uint256 amount) external",
  "function depositFrom(address payer, uint256 amount) external",
  "function withdraw(address to, uint256 amount) external",
  "function executeStrategy(uint8 action, uint256 amountIn, bytes32 intentHash, string signedResponse, bytes teeSignature, bytes32 teeAttestation, uint256 deadline) external",
  // Trustless-oracle (V2) execution path + its Pyth feed id. Harmless on standard
  // vaults (never called in standard mode); required so the agent can call it on
  // trustless-pyth vaults.
  "function executeStrategyWithPyth(uint8 action, uint256 amountIn, bytes32 intentHash, string signedResponse, bytes teeSignature, bytes32 teeAttestation, uint256 deadline, bytes[] pythUpdateData) external payable",
  "function pythPriceId() view returns (bytes32)",
  "function pyth() view returns (address)",
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
  "event StrategyExecuted(uint256 indexed logIndex, uint8 action, uint256 amountIn, uint256 amountOut, uint256 tvlAfter, bytes32 intentHash, bytes32 responseHash, address teeSigner, bytes32 teeAttestation, uint256 deadline)",
] as const;

// AgentINFT ABI — minimal subset the agent runner needs to preflight the
// on-chain TEE-signer binding before calling executeStrategy.
//
// Uses `agentMetadata` (the public mapping getter) rather than the v2-only
// `intelligentDataOf` convenience view: `agentMetadata` is present on every
// deployed AgentINFT version, whereas `intelligentDataOf` reverts on the
// pre-v2 Galileo deployment. `ownerOf` / `totalSupply` let the runner resolve
// the agent's token id directly from the AgentINFT when the deployed
// VaultFactory predates the `agentTokenId()` getter.
export const AGENT_INFT_ABI = [
  "function isActiveAgent(address agent) external view returns (bool)",
  "function isActiveAgentWithSigner(address agent, address teeSigner) external view returns (bool)",
  "function isAuthorizedForVault(address agent, address vault) external view returns (bool)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function totalSupply() external view returns (uint256)",
  "function agentMetadata(uint256 tokenId) external view returns (bytes32 enclaveHash, bytes32 attestationHash, string provider, address teeSignerAddress, uint256 issuedAt, bool revoked, bytes32 metadataRootHash)",
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
