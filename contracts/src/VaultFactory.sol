// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TreasuryVault} from "./TreasuryVault.sol";

/// @title VaultFactory — Deploys per-user TreasuryVault clones (EIP-1167)
/// @notice Anyone can deploy their own treasury vault via this factory. Each
///         vault is an EIP-1167 minimal proxy pointing to a shared
///         TreasuryVault implementation, initialized with the caller as owner.
///         Three policy presets (Conservative / Balanced / Aggressive) are
///         baked in; users can also pass a custom policy bounded by
///         conservative caps.
///
///         The factory is intentionally *immutable*: agent, implementation,
///         token addresses, router, oracle and INFT contract are all set at
///         construction and cannot be changed. Upgrades happen by deploying
///         a new factory; users opt in by creating a new vault.
contract VaultFactory {
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────────

    enum PresetTier {
        Conservative, // 15% alloc · 2% drawdown · 0.5% slippage · 12h cooldown
        Balanced,     // 30% alloc · 5% drawdown · 1% slippage · 30min cooldown
        Aggressive,   // 50% alloc · 10% drawdown · 2% slippage · 60s cooldown
        Custom        // pass your own (bounded) policy
    }

    // ── Immutable state ──────────────────────────────────────────────────

    address public immutable implementation;
    address public immutable agent;
    address public immutable agentNFT;
    address public immutable router;
    address public immutable priceFeed;
    address public immutable base;
    address public immutable risk;

    // ── Mutable registry (factory owns no funds, only emits + tracks) ────

    address[] public allVaults;
    mapping(address => address[]) private _vaultsByOwner;

    // ── Events ───────────────────────────────────────────────────────────

    event VaultCreated(
        address indexed owner,
        address indexed vault,
        PresetTier tier,
        TreasuryVault.Policy policy,
        uint256 indexed index
    );
    event VaultSeeded(address indexed vault, address indexed payer, uint256 baseAmount);

    // ── Errors ───────────────────────────────────────────────────────────

    error ZeroAddress();
    error InvalidPreset();
    error CustomPolicyOutOfRange();

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(
        address _implementation,
        address _agent,
        address _agentNFT,
        address _router,
        address _priceFeed,
        address _base,
        address _risk
    ) {
        if (
            _implementation == address(0) ||
            _agent == address(0) ||
            _agentNFT == address(0) ||
            _router == address(0) ||
            _priceFeed == address(0) ||
            _base == address(0) ||
            _risk == address(0)
        ) revert ZeroAddress();

        implementation = _implementation;
        agent = _agent;
        agentNFT = _agentNFT;
        router = _router;
        priceFeed = _priceFeed;
        base = _base;
        risk = _risk;
    }

    // ── Vault creation ───────────────────────────────────────────────────

    /// @notice Deploy a new vault using one of the built-in policy presets.
    function createVault(PresetTier tier) external returns (address vault) {
        if (tier == PresetTier.Custom) revert InvalidPreset();
        return _createWithPolicy(tier, _presetPolicy(tier));
    }

    /// @notice Deploy a new vault with a custom policy. Bounded to prevent
    ///         absurd configurations (e.g. 100% allocation, 50% slippage).
    function createVaultWithCustomPolicy(TreasuryVault.Policy calldata customPolicy)
        external
        returns (address vault)
    {
        _validateCustomPolicy(customPolicy);
        return _createWithPolicy(PresetTier.Custom, customPolicy);
    }

    /// @notice Deploy a vault with a preset and atomically seed it with USDC.
    ///         Caller must `approve(factory, depositAmount)` on the base token first.
    function createVaultAndDeposit(PresetTier tier, uint256 depositAmount)
        external
        returns (address vault)
    {
        if (tier == PresetTier.Custom) revert InvalidPreset();
        vault = _createWithPolicy(tier, _presetPolicy(tier));
        if (depositAmount > 0) _seedFromCaller(vault, depositAmount);
    }

    /// @notice Deploy a vault with a custom policy and atomically seed it.
    function createVaultWithCustomPolicyAndDeposit(
        TreasuryVault.Policy calldata customPolicy,
        uint256 depositAmount
    ) external returns (address vault) {
        _validateCustomPolicy(customPolicy);
        vault = _createWithPolicy(PresetTier.Custom, customPolicy);
        if (depositAmount > 0) _seedFromCaller(vault, depositAmount);
    }

    // ── Internal ─────────────────────────────────────────────────────────

    function _createWithPolicy(PresetTier tier, TreasuryVault.Policy memory pol)
        private
        returns (address vault)
    {
        vault = Clones.clone(implementation);

        TreasuryVault.InitParams memory params = TreasuryVault.InitParams({
            owner: msg.sender,
            base: base,
            risk: risk,
            agentNFT: agentNFT,
            router: router,
            priceFeed: priceFeed,
            agent: agent,
            policy: pol
        });
        TreasuryVault(vault).initialize(params);

        uint256 index = allVaults.length;
        allVaults.push(vault);
        _vaultsByOwner[msg.sender].push(vault);

        emit VaultCreated(msg.sender, vault, tier, pol, index);
    }

    function _seedFromCaller(address vault, uint256 amount) private {
        // Pull USDC from caller and forward into the vault.
        IERC20 baseToken = IERC20(base);
        baseToken.safeTransferFrom(msg.sender, address(this), amount);
        baseToken.forceApprove(vault, amount);
        TreasuryVault(vault).depositFrom(address(this), amount);
        emit VaultSeeded(vault, msg.sender, amount);
    }

    function _presetPolicy(PresetTier tier) private pure returns (TreasuryVault.Policy memory) {
        if (tier == PresetTier.Conservative) {
            return TreasuryVault.Policy({
                maxAllocationBps: 1500,
                maxDrawdownBps: 200,
                rebalanceThresholdBps: 200,
                maxSlippageBps: 50,
                cooldownPeriod: 43200,
                maxPriceStaleness: 120
            });
        } else if (tier == PresetTier.Balanced) {
            return TreasuryVault.Policy({
                maxAllocationBps: 3000,
                maxDrawdownBps: 500,
                rebalanceThresholdBps: 300,
                maxSlippageBps: 100,
                cooldownPeriod: 1800,
                maxPriceStaleness: 120
            });
        } else if (tier == PresetTier.Aggressive) {
            return TreasuryVault.Policy({
                maxAllocationBps: 5000,
                maxDrawdownBps: 1000,
                rebalanceThresholdBps: 500,
                maxSlippageBps: 200,
                cooldownPeriod: 60,
                maxPriceStaleness: 180
            });
        }
        revert InvalidPreset();
    }

    function _validateCustomPolicy(TreasuryVault.Policy calldata p) private pure {
        // Conservative caps to prevent absurd custom policies. Stables-first
        // mandate enforced via maxAllocationBps ≤ 5000 (= 50% of TVL).
        if (
            p.maxAllocationBps == 0 ||
            p.maxAllocationBps > 5000 ||
            p.maxDrawdownBps == 0 ||
            p.maxDrawdownBps > 2000 ||
            p.rebalanceThresholdBps > 5000 ||
            p.maxSlippageBps == 0 ||
            p.maxSlippageBps > 500 ||
            p.cooldownPeriod < 60 ||
            p.maxPriceStaleness < 30 ||
            p.maxPriceStaleness > 600
        ) revert CustomPolicyOutOfRange();
    }

    // ── Views ────────────────────────────────────────────────────────────

    function vaultsCount() external view returns (uint256) {
        return allVaults.length;
    }

    function vaultsByOwner(address account) external view returns (address[] memory) {
        return _vaultsByOwner[account];
    }

    function vaultsByOwnerCount(address account) external view returns (uint256) {
        return _vaultsByOwner[account].length;
    }

    /// @notice Paginated read of allVaults to allow large lists in subgraphs / UIs.
    function vaultsPage(uint256 start, uint256 limit)
        external
        view
        returns (address[] memory page)
    {
        uint256 total = allVaults.length;
        if (start >= total) return new address[](0);
        uint256 end = start + limit;
        if (end > total) end = total;
        page = new address[](end - start);
        for (uint256 i = start; i < end; i++) {
            page[i - start] = allVaults[i];
        }
    }

    /// @notice Get the policy that would be applied for a preset (UX helper).
    function previewPresetPolicy(PresetTier tier)
        external
        pure
        returns (TreasuryVault.Policy memory)
    {
        if (tier == PresetTier.Custom) revert InvalidPreset();
        return _presetPolicy(tier);
    }
}
