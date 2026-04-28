// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentINFT} from "./AgentINFT.sol";
import {SentriSwapRouter} from "./SentriSwapRouter.sol";
import {SentriPriceFeed} from "./SentriPriceFeed.sol";

/// @title TreasuryVault — Autonomous treasury executing real swaps under policy
/// @notice Holds a base stable asset and a risk asset. The agent executes real
///         swaps through a router, with slippage enforced against an oracle
///         price. All actions are policy-gated and logged on-chain.
contract TreasuryVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────────

    struct Policy {
        uint16 maxAllocationBps;      // max % of TVL allocated per action
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
        bytes32 proofHash;
        bytes32 teeAttestation;
    }

    // ── State ────────────────────────────────────────────────────────────

    IERC20 public immutable base;        // e.g. MockUSDC
    IERC20 public immutable risk;        // e.g. MockWETH
    uint8 public immutable baseDecimals;
    uint8 public immutable riskDecimals;

    AgentINFT public immutable agentNFT;
    SentriSwapRouter public immutable router;
    SentriPriceFeed public immutable priceFeed;

    address public agent;
    Policy public policy;

    uint256 public highWaterMark; // in base units (TVL denominated in base)
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
        bytes32 proofHash,
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

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        if (!agentNFT.isActiveAgent(msg.sender)) revert AgentNotVerified();
        _;
    }

    modifier notKilled() {
        if (killed) revert VaultKilled();
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(
        address _base,
        address _risk,
        address _agentNFT,
        address _router,
        address _priceFeed,
        address _agent,
        Policy memory _policy
    ) Ownable(msg.sender) {
        if (
            _base == address(0) ||
            _risk == address(0) ||
            _agentNFT == address(0) ||
            _router == address(0) ||
            _priceFeed == address(0) ||
            _agent == address(0)
        ) revert ZeroAddress();
        _validatePolicy(_policy);

        base = IERC20(_base);
        risk = IERC20(_risk);
        baseDecimals = IERC20Metadata(_base).decimals();
        riskDecimals = IERC20Metadata(_risk).decimals();
        agentNFT = AgentINFT(_agentNFT);
        router = SentriSwapRouter(_router);
        priceFeed = SentriPriceFeed(_priceFeed);
        agent = _agent;
        policy = _policy;
    }

    // ── Deposit / Withdraw ───────────────────────────────────────────────

    function deposit(uint256 amount) external whenNotPaused notKilled nonReentrant {
        if (amount == 0) revert ZeroAmount();
        base.safeTransferFrom(msg.sender, address(this), amount);
        _bumpHighWaterMark();
        emit Deposited(msg.sender, amount);
    }

    function withdraw(address to, uint256 amount) external onlyOwner whenNotPaused notKilled nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        base.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    // ── Strategy Execution ───────────────────────────────────────────────

    /// @notice Execute a strategy action with a real on-chain swap.
    /// @param action Action type (direction of swap)
    /// @param amountIn For Rebalance/YieldFarm: base amount to allocate. For
    ///                 EmergencyDeleverage: risk amount to unwind.
    /// @param proofHash Hash of the inference proof from Sealed Inference
    /// @param teeAttestation TEE attestation hash
    function executeStrategy(
        Action action,
        uint256 amountIn,
        bytes32 proofHash,
        bytes32 teeAttestation
    ) external onlyAgent whenNotPaused notKilled nonReentrant {
        if (amountIn == 0) revert ZeroAmount();

        _enforceCooldown();

        uint256 price = _fetchPrice();
        uint8 feedDec = priceFeed.decimals();

        uint256 amountOut;
        if (action == Action.EmergencyDeleverage) {
            if (risk.balanceOf(address(this)) < amountIn) revert InsufficientRiskBalance();
            uint256 expectedBase = _quoteRiskToBase(amountIn, price, feedDec);
            _enforceAllocation(expectedBase); // sized vs TVL in base units
            uint256 minOut = (expectedBase * (10_000 - policy.maxSlippageBps)) / 10_000;
            amountOut = _doSwap(address(risk), amountIn, minOut);
        } else {
            // Base -> Risk
            if (base.balanceOf(address(this)) < amountIn) revert ZeroAmount();
            _enforceAllocation(amountIn);
            uint256 expectedRisk = _quoteBaseToRisk(amountIn, price, feedDec);
            uint256 minOut = (expectedRisk * (10_000 - policy.maxSlippageBps)) / 10_000;
            amountOut = _doSwap(address(base), amountIn, minOut);
        }

        uint256 tvlAfter = _tvl(price, feedDec);
        _enforceDrawdown(tvlAfter);

        lastExecutionTime = block.timestamp;
        if (tvlAfter > highWaterMark) highWaterMark = tvlAfter;

        uint256 logIndex = executionLogs.length;
        executionLogs.push(ExecutionLog({
            timestamp: block.timestamp,
            action: action,
            amountIn: amountIn,
            amountOut: amountOut,
            tvlAfter: tvlAfter,
            proofHash: proofHash,
            teeAttestation: teeAttestation
        }));

        emit StrategyExecuted(logIndex, action, amountIn, amountOut, tvlAfter, proofHash, teeAttestation);
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

    function setAgent(address _agent) external onlyOwner {
        if (_agent == address(0)) revert ZeroAddress();
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    // ── Views ────────────────────────────────────────────────────────────

    function executionLogCount() external view returns (uint256) {
        return executionLogs.length;
    }

    /// @notice Legacy view: base token balance only
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

    function _fetchPrice() internal view returns (uint256) {
        (, int256 ans,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (ans <= 0) revert PriceStale();
        if (block.timestamp - updatedAt > policy.maxPriceStaleness) revert PriceStale();
        return uint256(ans);
    }

    /// @dev base value of `riskAmount` using `price` (price of 1 risk in base)
    function _quoteRiskToBase(uint256 riskAmount, uint256 price, uint8 feedDec) internal view returns (uint256) {
        // value = riskAmount * price / 10^feedDec, then decimal-adjust risk->base
        // value_in_base = riskAmount * price * 10^baseDec / (10^feedDec * 10^riskDec)
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
            // No oracle data yet (e.g. first deposit): use base balance
            uint256 b = base.balanceOf(address(this));
            if (b > highWaterMark) highWaterMark = b;
            return;
        }
        uint256 tvl = _tvl(price, priceFeed.decimals());
        if (tvl > highWaterMark) highWaterMark = tvl;
    }

    function _fetchPriceOrZero() internal view returns (uint256) {
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

    function _enforceAllocation(uint256 baseEquivalent) internal view {
        uint256 price = _fetchPrice();
        uint256 tvl = _tvl(price, priceFeed.decimals());
        uint256 maxAllocation = (tvl * policy.maxAllocationBps) / 10_000;
        if (baseEquivalent > maxAllocation) revert AllocationExceeded();
    }

    function _enforceDrawdown(uint256 tvlAfter) internal view {
        if (highWaterMark == 0) return;
        uint256 maxDrawdown = (highWaterMark * policy.maxDrawdownBps) / 10_000;
        if (tvlAfter + maxDrawdown < highWaterMark) revert DrawdownBreached();
    }

    function _validatePolicy(Policy memory _policy) internal pure {
        if (
            _policy.maxAllocationBps == 0 ||
            _policy.maxAllocationBps > 10_000 ||
            _policy.maxDrawdownBps == 0 ||
            _policy.maxDrawdownBps > 10_000 ||
            _policy.rebalanceThresholdBps > 10_000 ||
            _policy.maxSlippageBps > 10_000 ||
            _policy.maxPriceStaleness == 0
        ) revert InvalidPolicy();
    }
}
