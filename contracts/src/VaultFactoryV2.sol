// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TreasuryVaultTrustlessOracle} from "./TreasuryVaultTrustlessOracle.sol";
import {AgentINFT} from "./AgentINFT.sol";

/// @title VaultFactoryV2 — Deploys TreasuryVaultTrustlessOracle clones (EIP-1167)
/// @notice Parallel factory that creates trustless-oracle vaults where the
///         Pyth pull oracle replaces the keeper-pushed SentriPriceFeed in the
///         execution path. Does NOT replace or modify VaultFactory / VaultV1.
///
///         Immutable at deployment. Upgrades happen via a new factory address.
contract VaultFactoryV2 {
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────────

    /// @dev Mirror of TreasuryVaultTrustlessOracle.PresetTier for easy external use.
    enum PresetTier { Conservative, Balanced, Aggressive, Custom }

    // ── Immutable state ──────────────────────────────────────────────────

    address public immutable implementation; // TrustlessOracle master clone
    address public immutable agent;
    address public immutable agentNFT;
    address public immutable router;
    address public immutable base;
    address public immutable risk;
    address public immutable pyth;
    bytes32 public immutable pythPriceId;
    uint256 public immutable agentTokenId;

    // ── Mutable registry ─────────────────────────────────────────────────

    address[] public allVaults;
    mapping(address => address[]) private _vaultsByOwner;

    // ── Events ───────────────────────────────────────────────────────────

    event TrustlessOracleVaultCreated(
        address indexed owner,
        address indexed vault,
        address indexed agent,
        bytes32 priceId,
        address pyth
    );
    event VaultSeeded(address indexed vault, address indexed payer, uint256 baseAmount);

    // ── Errors ───────────────────────────────────────────────────────────

    error ZeroAddress();
    error CustomPolicyOutOfRange();

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(
        address _implementation,
        address _agent,
        address _agentNFT,
        address _router,
        address _base,
        address _risk,
        address _pyth,
        bytes32 _pythPriceId,
        uint256 _agentTokenId
    ) {
        if (
            _implementation == address(0) ||
            _agent          == address(0) ||
            _agentNFT       == address(0) ||
            _router         == address(0) ||
            _base           == address(0) ||
            _risk           == address(0) ||
            _pyth           == address(0)
        ) revert ZeroAddress();

        implementation = _implementation;
        agent          = _agent;
        agentNFT       = _agentNFT;
        router         = _router;
        base           = _base;
        risk           = _risk;
        pyth           = _pyth;
        pythPriceId    = _pythPriceId;
        agentTokenId   = _agentTokenId;
    }

    // ── Vault creation ───────────────────────────────────────────────────

    /// @notice Deploy a trustless-oracle vault with a policy preset.
    function createVault(PresetTier tier) external returns (address vault) {
        TreasuryVaultTrustlessOracle.Policy memory p = _presetPolicy(tier);
        vault = _deployVault(msg.sender, p);
    }

    /// @notice Deploy a trustless-oracle vault and atomically seed it with base tokens.
    function createVaultAndDeposit(PresetTier tier, uint256 depositAmount)
        external
        returns (address vault)
    {
        TreasuryVaultTrustlessOracle.Policy memory p = _presetPolicy(tier);
        vault = _deployVault(msg.sender, p);
        if (depositAmount > 0) {
            IERC20(base).safeTransferFrom(msg.sender, address(this), depositAmount);
            IERC20(base).forceApprove(vault, depositAmount);
            TreasuryVaultTrustlessOracle(payable(vault)).depositFrom(address(this), depositAmount);
            emit VaultSeeded(vault, msg.sender, depositAmount);
        }
    }

    /// @notice Deploy a trustless-oracle vault with a custom policy.
    function createVaultWithCustomPolicy(
        TreasuryVaultTrustlessOracle.Policy calldata customPolicy
    ) external returns (address vault) {
        _validateCustomPolicy(customPolicy);
        vault = _deployVault(msg.sender, customPolicy);
    }

    // ── Internal ─────────────────────────────────────────────────────────

    function _deployVault(
        address owner,
        TreasuryVaultTrustlessOracle.Policy memory pol
    ) internal returns (address vault) {
        vault = Clones.clone(implementation);

        // 60-second maxAge by default (aligns to policy.maxPriceStaleness).
        TreasuryVaultTrustlessOracle.TrustlessInitParams memory params =
            TreasuryVaultTrustlessOracle.TrustlessInitParams({
                owner:        owner,
                base:         base,
                risk:         risk,
                agentNFT:     agentNFT,
                router:       router,
                agent:        agent,
                policy:       pol,
                pyth:         pyth,
                pythPriceId:  pythPriceId,
                pythMaxAge:   60,
                pythMaxConfBps: 200  // 2% max confidence interval
            });

        TreasuryVaultTrustlessOracle(payable(vault)).initialize(params);

        if (AgentINFT(agentNFT).authorizedFactories(address(this))) {
            AgentINFT(agentNFT).authorizeUsageFromFactory(agentTokenId, vault);
        }

        allVaults.push(vault);
        _vaultsByOwner[owner].push(vault);

        emit TrustlessOracleVaultCreated(owner, vault, agent, pythPriceId, pyth);
    }

    function _presetPolicy(PresetTier tier)
        internal
        pure
        returns (TreasuryVaultTrustlessOracle.Policy memory)
    {
        if (tier == PresetTier.Conservative) {
            return TreasuryVaultTrustlessOracle.Policy({
                maxAllocationBps:      1500,
                maxDrawdownBps:         200,
                rebalanceThresholdBps:  300,
                maxSlippageBps:          50,
                cooldownPeriod:       43200, // 12 h
                maxPriceStaleness:       60
            });
        }
        if (tier == PresetTier.Balanced) {
            return TreasuryVaultTrustlessOracle.Policy({
                maxAllocationBps:      3000,
                maxDrawdownBps:         500,
                rebalanceThresholdBps:  300,
                maxSlippageBps:         100,
                cooldownPeriod:        1800, // 30 min
                maxPriceStaleness:       60
            });
        }
        if (tier == PresetTier.Aggressive) {
            return TreasuryVaultTrustlessOracle.Policy({
                maxAllocationBps:      5000,
                maxDrawdownBps:        1000,
                rebalanceThresholdBps:  300,
                maxSlippageBps:         200,
                cooldownPeriod:          60, // 1 min
                maxPriceStaleness:       60
            });
        }
        // Custom tier — caller must use createVaultWithCustomPolicy
        revert CustomPolicyOutOfRange();
    }

    function _validateCustomPolicy(
        TreasuryVaultTrustlessOracle.Policy calldata p
    ) internal pure {
        if (
            p.maxAllocationBps  > 5000 ||
            p.maxDrawdownBps    > 2000 ||
            p.maxSlippageBps    > 500  ||
            p.cooldownPeriod    < 60   ||
            p.maxPriceStaleness < 30   ||
            p.maxPriceStaleness > 600
        ) revert CustomPolicyOutOfRange();
    }

    // ── Views ────────────────────────────────────────────────────────────

    function vaultCount() external view returns (uint256) { return allVaults.length; }

    function vaultsByOwner(address owner) external view returns (address[] memory) {
        return _vaultsByOwner[owner];
    }
}
