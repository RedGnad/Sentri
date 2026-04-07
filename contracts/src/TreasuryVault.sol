// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TreasuryVault — Autonomous treasury with policy engine and kill-switch
/// @notice Holds stablecoin funds, enforces risk policies, logs every execution on-chain
contract TreasuryVault is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────────

    struct Policy {
        uint16 maxAllocationBps;      // max % of vault allocated per action (basis points)
        uint16 maxDrawdownBps;        // max drawdown from high-water mark (basis points)
        uint16 rebalanceThresholdBps; // min drift before rebalance allowed (basis points)
        uint32 cooldownPeriod;        // seconds between executions
    }

    enum Action {
        Rebalance,
        YieldFarm,
        EmergencyDeleverage
    }

    struct ExecutionLog {
        uint256 timestamp;
        Action action;
        uint256 amount;
        bytes32 proofHash;
        bytes32 teeAttestation;
    }

    // ── State ────────────────────────────────────────────────────────────

    IERC20 public immutable asset;
    address public agent;
    Policy public policy;

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
        uint256 amount,
        bytes32 proofHash,
        bytes32 teeAttestation
    );
    event PolicyUpdated(Policy newPolicy);
    event AgentUpdated(address newAgent);
    event EmergencyKillSwitchActivated(address indexed by, uint256 amountWithdrawn);

    // ── Errors ───────────────────────────────────────────────────────────

    error NotAgent();
    error VaultKilled();
    error ZeroAmount();
    error ZeroAddress();
    error CooldownNotElapsed();
    error AllocationExceeded();
    error DrawdownBreached();
    error InvalidPolicy();

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier notKilled() {
        if (killed) revert VaultKilled();
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────

    /// @param _asset Stablecoin address (MockUSDC)
    /// @param _agent Agent address allowed to execute strategies
    /// @param _policy Initial risk policy
    constructor(
        address _asset,
        address _agent,
        Policy memory _policy
    ) Ownable(msg.sender) {
        if (_asset == address(0)) revert ZeroAddress();
        if (_agent == address(0)) revert ZeroAddress();
        _validatePolicy(_policy);

        asset = IERC20(_asset);
        agent = _agent;
        policy = _policy;
    }

    // ── Deposit / Withdraw ───────────────────────────────────────────────

    /// @notice Deposit stablecoins into the vault
    /// @param amount Amount to deposit (6-decimal units)
    function deposit(uint256 amount) external whenNotPaused notKilled nonReentrant {
        if (amount == 0) revert ZeroAmount();

        asset.safeTransferFrom(msg.sender, address(this), amount);

        uint256 balance = asset.balanceOf(address(this));
        if (balance > highWaterMark) {
            highWaterMark = balance;
        }

        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw stablecoins from the vault (owner only)
    /// @param to Recipient address
    /// @param amount Amount to withdraw
    function withdraw(address to, uint256 amount) external onlyOwner whenNotPaused notKilled nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        asset.safeTransfer(to, amount);

        emit Withdrawn(to, amount);
    }

    // ── Strategy Execution ───────────────────────────────────────────────

    /// @notice Execute a strategy action — only callable by the agent
    /// @param action The action type
    /// @param amount Amount involved in the action
    /// @param proofHash Hash of the inference proof from Sealed Inference
    /// @param teeAttestation TEE attestation hash
    function executeStrategy(
        Action action,
        uint256 amount,
        bytes32 proofHash,
        bytes32 teeAttestation
    ) external onlyAgent whenNotPaused notKilled nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Policy checks
        _enforceCooldown();
        _enforceAllocation(amount);
        _enforceDrawdown(amount);

        lastExecutionTime = block.timestamp;

        uint256 logIndex = executionLogs.length;
        executionLogs.push(ExecutionLog({
            timestamp: block.timestamp,
            action: action,
            amount: amount,
            proofHash: proofHash,
            teeAttestation: teeAttestation
        }));

        // Update high-water mark
        uint256 balance = asset.balanceOf(address(this));
        if (balance > highWaterMark) {
            highWaterMark = balance;
        }

        emit StrategyExecuted(logIndex, action, amount, proofHash, teeAttestation);
    }

    // ── Kill-Switch ──────────────────────────────────────────────────────

    /// @notice Emergency withdraw ALL funds to owner and permanently kill the vault
    function emergencyWithdraw() external onlyOwner nonReentrant {
        killed = true;
        uint256 balance = asset.balanceOf(address(this));
        if (balance > 0) {
            asset.safeTransfer(owner(), balance);
        }

        emit EmergencyKillSwitchActivated(msg.sender, balance);
    }

    // ── Pause / Unpause ──────────────────────────────────────────────────

    /// @notice Pause the vault — blocks deposits, withdrawals, and executions
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the vault
    function unpause() external onlyOwner {
        _unpause();
    }

    // ── Admin ────────────────────────────────────────────────────────────

    /// @notice Update risk policy
    /// @param _policy New policy parameters
    function setPolicy(Policy calldata _policy) external onlyOwner {
        _validatePolicy(_policy);
        policy = _policy;
        emit PolicyUpdated(_policy);
    }

    /// @notice Update agent address
    /// @param _agent New agent address
    function setAgent(address _agent) external onlyOwner {
        if (_agent == address(0)) revert ZeroAddress();
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    // ── View ─────────────────────────────────────────────────────────────

    /// @notice Total number of execution logs
    function executionLogCount() external view returns (uint256) {
        return executionLogs.length;
    }

    /// @notice Current vault balance
    function vaultBalance() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    // ── Internal ─────────────────────────────────────────────────────────

    function _enforceCooldown() internal view {
        if (
            lastExecutionTime != 0 &&
            block.timestamp < lastExecutionTime + policy.cooldownPeriod
        ) {
            revert CooldownNotElapsed();
        }
    }

    function _enforceAllocation(uint256 amount) internal view {
        uint256 balance = asset.balanceOf(address(this));
        uint256 maxAllocation = (balance * policy.maxAllocationBps) / 10_000;
        if (amount > maxAllocation) {
            revert AllocationExceeded();
        }
    }

    function _enforceDrawdown(uint256 amount) internal view {
        if (highWaterMark == 0) return;
        uint256 balance = asset.balanceOf(address(this));
        uint256 balanceAfter = balance >= amount ? balance - amount : 0;
        uint256 maxDrawdown = (highWaterMark * policy.maxDrawdownBps) / 10_000;
        if (highWaterMark - balanceAfter > maxDrawdown) {
            revert DrawdownBreached();
        }
    }

    function _validatePolicy(Policy memory _policy) internal pure {
        if (
            _policy.maxAllocationBps == 0 ||
            _policy.maxAllocationBps > 10_000 ||
            _policy.maxDrawdownBps == 0 ||
            _policy.maxDrawdownBps > 10_000 ||
            _policy.rebalanceThresholdBps > 10_000
        ) {
            revert InvalidPolicy();
        }
    }
}
