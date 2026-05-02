// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {AgentINFT} from "./AgentINFT.sol";
import {SentriSwapRouter} from "./SentriSwapRouter.sol";
import {SentriPriceFeed} from "./SentriPriceFeed.sol";

/// @title TreasuryVault — Per-user verifiable autonomous treasury (clone implementation)
/// @notice Holds a base stable asset and a risk asset. The agent executes real
///         swaps through a router, with slippage enforced against an oracle
///         price. All actions are policy-gated and logged on-chain. Designed
///         to be deployed via VaultFactory as an EIP-1167 minimal proxy clone.
contract TreasuryVault is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────────

    struct Policy {
        uint16 maxAllocationBps;      // max post-trade risk exposure as % of TVL
        uint16 maxDrawdownBps;        // max drawdown from high-water mark
        uint16 rebalanceThresholdBps; // informational drift threshold
        uint16 maxSlippageBps;        // max acceptable slippage vs oracle
        uint32 cooldownPeriod;        // seconds between executions
        uint32 maxPriceStaleness;     // max age of oracle price, seconds
    }

    enum Action {
        Rebalance,           // base -> risk
        YieldFarm,           // base -> risk (semantic alias, same direction)
        EmergencyDeleverage  // risk -> base
    }

    struct ExecutionLog {
        uint256 timestamp;
        Action action;
        uint256 amountIn;
        uint256 amountOut;
        uint256 tvlAfter;
        bytes32 intentHash;
        bytes32 responseHash;
        address teeSigner;
        bytes32 teeAttestation;
    }

    /// @notice Bundle of init params passed by the factory at clone init.
    struct InitParams {
        address owner;
        address base;
        address risk;
        address agentNFT;
        address router;
        address priceFeed;
        address agent;
        Policy policy;
    }

    // ── State ────────────────────────────────────────────────────────────

    IERC20 public base;        // e.g. MockUSDC
    IERC20 public risk;        // e.g. MockWETH
    uint8 public baseDecimals;
    uint8 public riskDecimals;

    AgentINFT public agentNFT;
    SentriSwapRouter public router;
    SentriPriceFeed public priceFeed;

    address public agent;
    address public factory;
    Policy public policy;

    /// @notice High-water mark of TVL (in base units). Bumped on deposit and
    ///         on profitable strategy execution. Scaled DOWN proportionally on
    ///         withdraw so per-share NAV peak is preserved (a withdrawal
    ///         shrinks the vault but does not register as drawdown).
    uint256 public highWaterMark;
    uint256 public lastExecutionTime;

    ExecutionLog[] public executionLogs;

    bool public killed;

    // ── Events ───────────────────────────────────────────────────────────

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event StrategyExecuted(
        uint256 indexed logIndex,
        Action action,
        uint256 amountIn,
        uint256 amountOut,
        uint256 tvlAfter,
        bytes32 intentHash,
        bytes32 responseHash,
        address teeSigner,
        bytes32 teeAttestation
    );
    event PolicyUpdated(Policy newPolicy);
    event AgentUpdated(address newAgent);
    event EmergencyKillSwitchActivated(address indexed by, uint256 baseWithdrawn, uint256 riskWithdrawn);

    // ── Errors ───────────────────────────────────────────────────────────

    error NotAgent();
    error AgentNotVerified();
    error VaultKilled();
    error ZeroAmount();
    error ZeroAddress();
    error CooldownNotElapsed();
    error AllocationExceeded();
    error DrawdownBreached();
    error InvalidPolicy();
    error PriceStale();
    error InsufficientRiskBalance();
    error NotFactory();
    error InvalidTEESignature();

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        if (!agentNFT.isActiveAgent(msg.sender)) revert AgentNotVerified();
        _;
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    modifier notKilled() {
        if (killed) revert VaultKilled();
        _;
    }

    // ── Constructor / Initializer ────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-shot initialization. Called once by the factory after a clone is deployed.
    /// @param p Bundle of all init params; see InitParams struct above.
    function initialize(InitParams calldata p) external initializer {
        if (
            p.owner == address(0) ||
            p.base == address(0) ||
            p.risk == address(0) ||
            p.agentNFT == address(0) ||
            p.router == address(0) ||
            p.priceFeed == address(0) ||
            p.agent == address(0)
        ) revert ZeroAddress();
        _validatePolicy(p.policy);

        // ReentrancyGuard uses storage default (0) which behaves as NOT_ENTERED
        // on clones, no init call needed. Ownable + Pausable do need __init.
        __Ownable_init(p.owner);
        __Pausable_init();

        base = IERC20(p.base);
        risk = IERC20(p.risk);
        baseDecimals = IERC20Metadata(p.base).decimals();
        riskDecimals = IERC20Metadata(p.risk).decimals();
        agentNFT = AgentINFT(p.agentNFT);
        router = SentriSwapRouter(p.router);
        priceFeed = SentriPriceFeed(p.priceFeed);
        agent = p.agent;
        factory = msg.sender;
        policy = p.policy;
    }

    // ── Deposit / Withdraw ───────────────────────────────────────────────

    /// @notice Deposit base tokens from the caller into the vault.
    function deposit(uint256 amount) external whenNotPaused notKilled nonReentrant {
        _depositFrom(msg.sender, amount);
    }

    /// @notice Deposit base tokens from an explicit payer (e.g. the factory
    ///         performing an atomic create-and-deposit on the user's behalf).
    ///         The payer must have approved `address(this)` to spend `amount`.
    function depositFrom(address payer, uint256 amount) external onlyFactory whenNotPaused notKilled nonReentrant {
        _depositFrom(payer, amount);
    }

    function _depositFrom(address payer, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        if (payer == address(0)) revert ZeroAddress();
        base.safeTransferFrom(payer, address(this), amount);
        _bumpHighWaterMark();
        emit Deposited(payer, amount);
    }

    /// @notice Withdraw base tokens to a recipient. HWM is scaled DOWN
    ///         proportionally to preserve per-share NAV peak (withdrawals
    ///         shrink the vault but should not register as strategy drawdown).
    function withdraw(address to, uint256 amount) external onlyOwner whenNotPaused notKilled nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 price = _fetchPriceOrZero();
        uint8 feedDec = priceFeed.decimals();
        uint256 tvlBefore = (price > 0) ? _tvl(price, feedDec) : base.balanceOf(address(this));

        base.safeTransfer(to, amount);

        if (highWaterMark > 0 && tvlBefore > 0) {
            uint256 tvlAfter = (price > 0) ? _tvl(price, feedDec) : base.balanceOf(address(this));
            highWaterMark = (highWaterMark * tvlAfter) / tvlBefore;
        }
        emit Withdrawn(to, amount);
    }

    // ── Strategy Execution ───────────────────────────────────────────────

    /// @notice Execute a strategy action with a real on-chain swap.
    /// @param action Action type (direction of swap)
    /// @param amountIn For Rebalance/YieldFarm: base amount to allocate. For
    ///                 EmergencyDeleverage: risk amount to unwind.
    /// @param intentHash Hash of the canonical execution intent stored in 0G Storage
    /// @param signedResponse Compact TEE-signed JSON response from the 0G provider
    /// @param teeSignature EIP-191 signature over `signedResponse`
    /// @param teeAttestation TEE attestation hash
    function executeStrategy(
        Action action,
        uint256 amountIn,
        bytes32 intentHash,
        string calldata signedResponse,
        bytes calldata teeSignature,
        bytes32 teeAttestation
    ) external onlyAgent whenNotPaused notKilled nonReentrant {
        if (amountIn == 0) revert ZeroAmount();
        (address teeSigner, bytes32 responseHash) = _verifyTEE(signedResponse, teeSignature);

        _enforceCooldown();

        // Checks-effects-interactions: bump cooldown timestamp BEFORE the
        // external swap call. Prevents any same-block re-entry (in addition
        // to nonReentrant) and silences Slither's cross-function reentrancy
        // detector. If the swap reverts, this whole TX reverts and the
        // timestamp update is undone.
        lastExecutionTime = block.timestamp;

        uint256 price = _fetchPrice();
        uint8 feedDec = priceFeed.decimals();

        uint256 amountOut;
        if (action == Action.EmergencyDeleverage) {
            if (risk.balanceOf(address(this)) < amountIn) revert InsufficientRiskBalance();
            uint256 expectedBase = _quoteRiskToBase(amountIn, price, feedDec);
            uint256 minOut = (expectedBase * (10_000 - policy.maxSlippageBps)) / 10_000;
            amountOut = _doSwap(address(risk), amountIn, minOut);
        } else {
            // Base -> Risk
            if (base.balanceOf(address(this)) < amountIn) revert ZeroAmount();
            uint256 expectedRisk = _quoteBaseToRisk(amountIn, price, feedDec);
            uint256 minOut = (expectedRisk * (10_000 - policy.maxSlippageBps)) / 10_000;
            amountOut = _doSwap(address(base), amountIn, minOut);
        }

        uint256 tvlAfter = _tvl(price, feedDec);
        if (action != Action.EmergencyDeleverage) {
            _enforceRiskExposure(tvlAfter, price, feedDec);
        }
        _enforceDrawdown(tvlAfter);

        if (tvlAfter > highWaterMark) highWaterMark = tvlAfter;

        uint256 logIndex = executionLogs.length;
        executionLogs.push(ExecutionLog({
            timestamp: block.timestamp,
            action: action,
            amountIn: amountIn,
            amountOut: amountOut,
            tvlAfter: tvlAfter,
            intentHash: intentHash,
            responseHash: responseHash,
            teeSigner: teeSigner,
            teeAttestation: teeAttestation
        }));

        emit StrategyExecuted(logIndex, action, amountIn, amountOut, tvlAfter, intentHash, responseHash, teeSigner, teeAttestation);
    }

    function _doSwap(address tokenIn, uint256 amountIn, uint256 minOut) internal returns (uint256) {
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        return router.swapExactTokensForTokens(
            tokenIn,
            amountIn,
            minOut,
            address(this),
            block.timestamp + 300
        );
    }

    // ── Kill-Switch ──────────────────────────────────────────────────────

    function emergencyWithdraw() external onlyOwner nonReentrant {
        killed = true;
        uint256 b = base.balanceOf(address(this));
        uint256 r = risk.balanceOf(address(this));
        if (b > 0) base.safeTransfer(owner(), b);
        if (r > 0) risk.safeTransfer(owner(), r);
        emit EmergencyKillSwitchActivated(msg.sender, b, r);
    }

    // ── Pause ────────────────────────────────────────────────────────────

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── Admin ────────────────────────────────────────────────────────────

    function setPolicy(Policy calldata _policy) external onlyOwner {
        _validatePolicy(_policy);
        policy = _policy;
        emit PolicyUpdated(_policy);
    }

    /// @notice Replace the agent address authorised to call executeStrategy.
    ///         Available to the owner so that, if the off-chain agent is
    ///         compromised, retired, or migrated to a new operator, the vault
    ///         can be re-pointed at a new identity in a single transaction —
    ///         without burning the AgentINFT or pausing the vault.
    /// @dev    The new agent must still hold an active (non-revoked) AgentINFT
    ///         for executeStrategy to succeed; this function only swaps the
    ///         allowed caller, the INFT gating still applies.
    function setAgent(address _agent) external onlyOwner {
        if (_agent == address(0)) revert ZeroAddress();
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    // ── Views ────────────────────────────────────────────────────────────

    function executionLogCount() external view returns (uint256) {
        return executionLogs.length;
    }

    /// @notice Base (USDC) token balance held directly by the vault. Excludes
    ///         the value of risk asset positions; use `totalValue()` for full TVL.
    function vaultBalance() external view returns (uint256) {
        return base.balanceOf(address(this));
    }

    /// @notice Total value of the vault, denominated in base units
    function totalValue() external view returns (uint256) {
        return _tvl(_fetchPrice(), priceFeed.decimals());
    }

    function riskBalance() external view returns (uint256) {
        return risk.balanceOf(address(this));
    }

    // ── Internal — pricing ───────────────────────────────────────────────

    /// @dev Fetch the current oracle price and reject if it is older than the
    ///      vault's policy.maxPriceStaleness. The agent is the sole keeper of
    ///      SentriPriceFeed and pushes a fresh value at the start of each
    ///      cycle, so a stale price here means the agent has stopped, the
    ///      oracle keeper changed, or the cycle is taking too long. In all
    ///      three cases refusing to swap is the safe default — better to skip
    ///      an iteration than execute against a stale price.
    function _fetchPrice() internal view returns (uint256) {
        // We intentionally ignore roundId, startedAt, answeredInRound — for
        // a single-feed AggregatorV3 keeper-pushed oracle the only fields
        // that matter are `ans` (price) and `updatedAt` (freshness).
        // slither-disable-next-line unused-return
        (, int256 ans,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (ans <= 0) revert PriceStale();
        if (block.timestamp - updatedAt > policy.maxPriceStaleness) revert PriceStale();
        return uint256(ans);
    }

    /// @dev base value of `riskAmount` using `price` (price of 1 risk in base)
    function _quoteRiskToBase(uint256 riskAmount, uint256 price, uint8 feedDec) internal view returns (uint256) {
        return (riskAmount * price * (10 ** baseDecimals)) / ((10 ** feedDec) * (10 ** riskDecimals));
    }

    /// @dev risk value of `baseAmount` using `price` (price of 1 risk in base)
    function _quoteBaseToRisk(uint256 baseAmount, uint256 price, uint8 feedDec) internal view returns (uint256) {
        return (baseAmount * (10 ** feedDec) * (10 ** riskDecimals)) / (price * (10 ** baseDecimals));
    }

    function _tvl(uint256 price, uint8 feedDec) internal view returns (uint256) {
        uint256 b = base.balanceOf(address(this));
        uint256 r = risk.balanceOf(address(this));
        return b + _quoteRiskToBase(r, price, feedDec);
    }

    function _bumpHighWaterMark() internal {
        uint256 price = _fetchPriceOrZero();
        if (price == 0) {
            uint256 b = base.balanceOf(address(this));
            if (b > highWaterMark) highWaterMark = b;
            return;
        }
        uint256 tvl = _tvl(price, priceFeed.decimals());
        if (tvl > highWaterMark) highWaterMark = tvl;
    }

    function _fetchPriceOrZero() internal view returns (uint256) {
        // Same as _fetchPrice but never reverts — used during deposits where
        // a missing oracle should not block the user (HWM bumps to balance only).
        // slither-disable-next-line unused-return
        try priceFeed.latestRoundData() returns (uint80, int256 ans, uint256, uint256, uint80) {
            if (ans <= 0) return 0;
            return uint256(ans);
        } catch {
            return 0;
        }
    }

    // ── Internal — policy ────────────────────────────────────────────────

    function _enforceCooldown() internal view {
        if (
            lastExecutionTime != 0 &&
            block.timestamp < lastExecutionTime + policy.cooldownPeriod
        ) revert CooldownNotElapsed();
    }

    function _verifyTEE(string calldata signedResponse, bytes calldata teeSignature)
        internal
        view
        returns (address teeSigner, bytes32 responseHash)
    {
        responseHash = keccak256(bytes(signedResponse));
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(signedResponse));
        teeSigner = ECDSA.recover(digest, teeSignature);
        if (!agentNFT.isActiveAgentWithSigner(msg.sender, teeSigner)) revert InvalidTEESignature();
    }

    function _enforceRiskExposure(uint256 tvlAfter, uint256 price, uint8 feedDec) internal view {
        uint256 riskValue = _quoteRiskToBase(risk.balanceOf(address(this)), price, feedDec);
        uint256 maxRiskValue = (tvlAfter * policy.maxAllocationBps) / 10_000;
        if (riskValue > maxRiskValue) revert AllocationExceeded();
    }

    function _enforceDrawdown(uint256 tvlAfter) internal view {
        if (highWaterMark == 0) return;
        uint256 maxDrawdown = (highWaterMark * policy.maxDrawdownBps) / 10_000;
        if (tvlAfter + maxDrawdown < highWaterMark) revert DrawdownBreached();
    }

    function _validatePolicy(Policy memory _policy) internal pure {
        if (
            _policy.maxAllocationBps == 0 ||
            _policy.maxAllocationBps > 5000 ||
            _policy.maxDrawdownBps == 0 ||
            _policy.maxDrawdownBps > 2000 ||
            _policy.rebalanceThresholdBps > 5000 ||
            _policy.maxSlippageBps == 0 ||
            _policy.maxSlippageBps > 500 ||
            _policy.cooldownPeriod < 60 ||
            _policy.maxPriceStaleness < 30 ||
            _policy.maxPriceStaleness > 600
        ) revert InvalidPolicy();
    }
}
