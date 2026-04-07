// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";

contract TreasuryVaultTest is Test {
    MockUSDC usdc;
    TreasuryVault vault;

    address owner = address(this);
    address agent = makeAddr("agent");
    address alice = makeAddr("alice");

    TreasuryVault.Policy defaultPolicy;

    function setUp() public {
        usdc = new MockUSDC();

        defaultPolicy = TreasuryVault.Policy({
            maxAllocationBps: 2000,       // 20%
            maxDrawdownBps: 1000,         // 10%
            rebalanceThresholdBps: 500,   // 5%
            cooldownPeriod: 60            // 60 seconds
        });

        vault = new TreasuryVault(address(usdc), agent, defaultPolicy);

        // Fund alice with 100k USDC
        usdc.mint(alice, 100_000e6);
    }

    // ── MockUSDC ─────────────────────────────────────────────────────────

    function test_MockUSDC_decimals() public view {
        assertEq(usdc.decimals(), 6);
    }

    function test_MockUSDC_mint() public {
        usdc.mint(address(0xBEEF), 1_000e6);
        assertEq(usdc.balanceOf(address(0xBEEF)), 1_000e6);
    }

    function test_MockUSDC_name_symbol() public view {
        assertEq(usdc.name(), "USD Coin");
        assertEq(usdc.symbol(), "USDC");
    }

    // ── Deposit ──────────────────────────────────────────────────────────

    function test_deposit() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 10_000e6);
        vault.deposit(10_000e6);
        vm.stopPrank();

        assertEq(vault.vaultBalance(), 10_000e6);
        assertEq(vault.highWaterMark(), 10_000e6);
    }

    function test_deposit_updatesHighWaterMark() public {
        _depositAs(alice, 5_000e6);
        assertEq(vault.highWaterMark(), 5_000e6);

        _depositAs(alice, 3_000e6);
        assertEq(vault.highWaterMark(), 8_000e6);
    }

    function test_deposit_reverts_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(TreasuryVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_deposit_reverts_whenPaused() public {
        vault.pause();
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert();
        vault.deposit(1_000e6);
        vm.stopPrank();
    }

    function test_deposit_reverts_whenKilled() public {
        vault.emergencyWithdraw();
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert(TreasuryVault.VaultKilled.selector);
        vault.deposit(1_000e6);
        vm.stopPrank();
    }

    // ── Withdraw ─────────────────────────────────────────────────────────

    function test_withdraw() public {
        _depositAs(alice, 10_000e6);

        vault.withdraw(alice, 5_000e6);
        assertEq(usdc.balanceOf(alice), 95_000e6); // 100k - 10k + 5k
        assertEq(vault.vaultBalance(), 5_000e6);
    }

    function test_withdraw_reverts_notOwner() public {
        _depositAs(alice, 10_000e6);

        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(alice, 5_000e6);
    }

    function test_withdraw_reverts_zeroAmount() public {
        vm.expectRevert(TreasuryVault.ZeroAmount.selector);
        vault.withdraw(alice, 0);
    }

    function test_withdraw_reverts_zeroAddress() public {
        _depositAs(alice, 10_000e6);
        vm.expectRevert(TreasuryVault.ZeroAddress.selector);
        vault.withdraw(address(0), 1_000e6);
    }

    // ── Execute Strategy ─────────────────────────────────────────────────

    function test_executeStrategy() public {
        _depositAs(alice, 10_000e6);

        bytes32 proofHash = keccak256("proof-1");
        bytes32 attestation = keccak256("tee-1");

        vm.prank(agent);
        vault.executeStrategy(
            TreasuryVault.Action.Rebalance,
            1_000e6, // 10% of 10k — within 20% max allocation
            proofHash,
            attestation
        );

        assertEq(vault.executionLogCount(), 1);

        (
            uint256 ts,
            TreasuryVault.Action action,
            uint256 amount,
            bytes32 ph,
            bytes32 att
        ) = vault.executionLogs(0);

        assertEq(ts, block.timestamp);
        assertEq(uint8(action), uint8(TreasuryVault.Action.Rebalance));
        assertEq(amount, 1_000e6);
        assertEq(ph, proofHash);
        assertEq(att, attestation);
    }

    function test_executeStrategy_reverts_notAgent() public {
        _depositAs(alice, 10_000e6);

        vm.prank(alice);
        vm.expectRevert(TreasuryVault.NotAgent.selector);
        vault.executeStrategy(
            TreasuryVault.Action.Rebalance,
            1_000e6,
            bytes32(0),
            bytes32(0)
        );
    }

    function test_executeStrategy_reverts_zeroAmount() public {
        _depositAs(alice, 10_000e6);

        vm.prank(agent);
        vm.expectRevert(TreasuryVault.ZeroAmount.selector);
        vault.executeStrategy(
            TreasuryVault.Action.Rebalance,
            0,
            bytes32(0),
            bytes32(0)
        );
    }

    // ── Policy: Cooldown ─────────────────────────────────────────────────

    function test_executeStrategy_reverts_cooldownNotElapsed() public {
        _depositAs(alice, 10_000e6);

        vm.prank(agent);
        vault.executeStrategy(
            TreasuryVault.Action.Rebalance,
            500e6,
            keccak256("p1"),
            keccak256("a1")
        );

        // Try again immediately — should revert
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.CooldownNotElapsed.selector);
        vault.executeStrategy(
            TreasuryVault.Action.Rebalance,
            500e6,
            keccak256("p2"),
            keccak256("a2")
        );
    }

    function test_executeStrategy_succeeds_afterCooldown() public {
        _depositAs(alice, 10_000e6);

        vm.prank(agent);
        vault.executeStrategy(
            TreasuryVault.Action.Rebalance,
            500e6,
            keccak256("p1"),
            keccak256("a1")
        );

        // Warp past cooldown
        vm.warp(block.timestamp + 61);

        vm.prank(agent);
        vault.executeStrategy(
            TreasuryVault.Action.YieldFarm,
            500e6,
            keccak256("p2"),
            keccak256("a2")
        );

        assertEq(vault.executionLogCount(), 2);
    }

    // ── Policy: Allocation ───────────────────────────────────────────────

    function test_executeStrategy_reverts_allocationExceeded() public {
        _depositAs(alice, 10_000e6);

        // maxAllocationBps = 2000 (20%) => max = 2000e6
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.AllocationExceeded.selector);
        vault.executeStrategy(
            TreasuryVault.Action.Rebalance,
            3_000e6, // 30% > 20%
            keccak256("p"),
            keccak256("a")
        );
    }

    // ── Policy: Drawdown ─────────────────────────────────────────────────

    function test_executeStrategy_reverts_drawdownBreached() public {
        _depositAs(alice, 10_000e6);
        // hwm = 10_000e6, maxDrawdownBps = 1000 (10%), max loss = 1_000e6

        // Withdraw some to simulate a prior loss — bring balance to 9_500e6
        vault.withdraw(owner, 500e6);

        // Now try to execute with 1_000e6 — total drawdown would be 1_500e6 > 1_000e6
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.DrawdownBreached.selector);
        vault.executeStrategy(
            TreasuryVault.Action.EmergencyDeleverage,
            1_000e6, // balance 9500, after = 8500, drawdown = 1500 > 1000
            keccak256("p"),
            keccak256("a")
        );
    }

    // ── Emergency Withdraw (Kill-Switch) ─────────────────────────────────

    function test_emergencyWithdraw() public {
        _depositAs(alice, 10_000e6);

        uint256 ownerBalBefore = usdc.balanceOf(owner);
        vault.emergencyWithdraw();

        assertEq(vault.killed(), true);
        assertEq(vault.vaultBalance(), 0);
        assertEq(usdc.balanceOf(owner), ownerBalBefore + 10_000e6);
    }

    function test_emergencyWithdraw_reverts_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.emergencyWithdraw();
    }

    function test_emergencyWithdraw_blocksDeposit() public {
        vault.emergencyWithdraw();

        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert(TreasuryVault.VaultKilled.selector);
        vault.deposit(1_000e6);
        vm.stopPrank();
    }

    function test_emergencyWithdraw_blocksExecute() public {
        _depositAs(alice, 10_000e6);
        vault.emergencyWithdraw();

        vm.prank(agent);
        vm.expectRevert(TreasuryVault.VaultKilled.selector);
        vault.executeStrategy(
            TreasuryVault.Action.Rebalance,
            500e6,
            bytes32(0),
            bytes32(0)
        );
    }

    // ── Pause / Unpause ──────────────────────────────────────────────────

    function test_pause_blocksDeposit() public {
        vault.pause();

        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert();
        vault.deposit(1_000e6);
        vm.stopPrank();
    }

    function test_pause_blocksWithdraw() public {
        _depositAs(alice, 10_000e6);
        vault.pause();

        vm.expectRevert();
        vault.withdraw(alice, 1_000e6);
    }

    function test_pause_blocksExecute() public {
        _depositAs(alice, 10_000e6);
        vault.pause();

        vm.prank(agent);
        vm.expectRevert();
        vault.executeStrategy(
            TreasuryVault.Action.Rebalance,
            500e6,
            bytes32(0),
            bytes32(0)
        );
    }

    function test_unpause_restoresDeposit() public {
        vault.pause();
        vault.unpause();

        _depositAs(alice, 1_000e6);
        assertEq(vault.vaultBalance(), 1_000e6);
    }

    function test_pause_reverts_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.pause();
    }

    // ── Admin ────────────────────────────────────────────────────────────

    function test_setPolicy() public {
        TreasuryVault.Policy memory newPolicy = TreasuryVault.Policy({
            maxAllocationBps: 3000,
            maxDrawdownBps: 1500,
            rebalanceThresholdBps: 300,
            cooldownPeriod: 120
        });

        vault.setPolicy(newPolicy);

        (uint16 alloc, uint16 dd, uint16 reb, uint32 cd) = vault.policy();
        assertEq(alloc, 3000);
        assertEq(dd, 1500);
        assertEq(reb, 300);
        assertEq(cd, 120);
    }

    function test_setPolicy_reverts_invalidPolicy() public {
        TreasuryVault.Policy memory badPolicy = TreasuryVault.Policy({
            maxAllocationBps: 0,
            maxDrawdownBps: 1000,
            rebalanceThresholdBps: 500,
            cooldownPeriod: 60
        });

        vm.expectRevert(TreasuryVault.InvalidPolicy.selector);
        vault.setPolicy(badPolicy);
    }

    function test_setAgent() public {
        address newAgent = makeAddr("newAgent");
        vault.setAgent(newAgent);
        assertEq(vault.agent(), newAgent);
    }

    function test_setAgent_reverts_zeroAddress() public {
        vm.expectRevert(TreasuryVault.ZeroAddress.selector);
        vault.setAgent(address(0));
    }

    // ── Constructor validation ───────────────────────────────────────────

    function test_constructor_reverts_zeroAsset() public {
        vm.expectRevert(TreasuryVault.ZeroAddress.selector);
        new TreasuryVault(address(0), agent, defaultPolicy);
    }

    function test_constructor_reverts_zeroAgent() public {
        vm.expectRevert(TreasuryVault.ZeroAddress.selector);
        new TreasuryVault(address(usdc), address(0), defaultPolicy);
    }

    function test_constructor_reverts_invalidPolicy() public {
        TreasuryVault.Policy memory badPolicy = TreasuryVault.Policy({
            maxAllocationBps: 10_001,
            maxDrawdownBps: 1000,
            rebalanceThresholdBps: 500,
            cooldownPeriod: 60
        });

        vm.expectRevert(TreasuryVault.InvalidPolicy.selector);
        new TreasuryVault(address(usdc), agent, badPolicy);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    function _depositAs(address user, uint256 amount) internal {
        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }
}
