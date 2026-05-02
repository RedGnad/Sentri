// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {SentriPair} from "../src/SentriPair.sol";
import {SentriSwapRouter} from "../src/SentriSwapRouter.sol";
import {SentriPriceFeed} from "../src/SentriPriceFeed.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// @notice End-to-end integration test: spin up the full stack via the
///         factory, create five vaults across three users with different
///         presets and one custom policy, run the agent across all of them,
///         and assert that operations on one vault never affect another.
contract MultiVaultTest is Test {
    MockUSDC usdc;
    MockWETH weth;
    AgentINFT agentNFT;
    SentriPair pair;
    SentriSwapRouter router;
    SentriPriceFeed feed;
    TreasuryVault impl;
    VaultFactory factory;

    address agent = makeAddr("agent");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address lper = makeAddr("lper");

    int256 constant PRICE = 2000 * 1e8;

    // 5 vaults that we'll create in setUp + a helper.
    address vAliceConservative;
    address vAliceBalanced;
    address vBobAggressive;
    address vBobCustom;
    address vCarolBalanced;

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockWETH();
        agentNFT = new AgentINFT();

        feed = new SentriPriceFeed(8, "WETH/USDC");
        feed.setKeeper(address(this), true);
        feed.pushAnswer(PRICE, keccak256("att-0"));

        (address t0, address t1) = address(usdc) < address(weth)
            ? (address(usdc), address(weth))
            : (address(weth), address(usdc));
        pair = new SentriPair(t0, t1);
        router = new SentriSwapRouter(address(pair));

        // Deep liquidity so 5 vaults can swap without breaking the K invariant.
        usdc.mint(lper, 10_000_000e6);
        weth.mint(lper, 5_000e18);
        vm.startPrank(lper);
        usdc.approve(address(router), type(uint256).max);
        weth.approve(address(router), type(uint256).max);
        (uint256 a0, uint256 a1) = t0 == address(usdc)
            ? (uint256(10_000_000e6), uint256(5_000e18))
            : (uint256(5_000e18), uint256(10_000_000e6));
        router.addLiquidity(a0, a1, lper, block.timestamp + 1);
        vm.stopPrank();

        agentNFT.mint(agent, keccak256("enclave"), keccak256("att"), "0G Sealed Inference");

        impl = new TreasuryVault();
        factory = new VaultFactory(
            address(impl),
            agent,
            address(agentNFT),
            address(router),
            address(feed),
            address(usdc),
            address(weth)
        );

        // ── Five vaults: 2 alice, 2 bob, 1 carol — across all preset tiers ──
        usdc.mint(alice, 200_000e6);
        usdc.mint(bob, 200_000e6);
        usdc.mint(carol, 100_000e6);

        vm.startPrank(alice);
        usdc.approve(address(factory), 200_000e6);
        vAliceConservative = factory.createVaultAndDeposit(VaultFactory.PresetTier.Conservative, 50_000e6);
        vAliceBalanced = factory.createVaultAndDeposit(VaultFactory.PresetTier.Balanced, 50_000e6);
        vm.stopPrank();

        TreasuryVault.Policy memory custom = TreasuryVault.Policy({
            maxAllocationBps: 4000,
            maxDrawdownBps: 1500,
            rebalanceThresholdBps: 600,
            maxSlippageBps: 250,
            cooldownPeriod: 120,
            maxPriceStaleness: 90
        });
        vm.startPrank(bob);
        usdc.approve(address(factory), 200_000e6);
        vBobAggressive = factory.createVaultAndDeposit(VaultFactory.PresetTier.Aggressive, 50_000e6);
        vBobCustom = factory.createVaultWithCustomPolicyAndDeposit(custom, 50_000e6);
        vm.stopPrank();

        vm.startPrank(carol);
        usdc.approve(address(factory), 100_000e6);
        vCarolBalanced = factory.createVaultAndDeposit(VaultFactory.PresetTier.Balanced, 100_000e6);
        vm.stopPrank();
    }

    // ── Setup sanity ─────────────────────────────────────────────────────

    function test_factory_tracksAllFiveVaults() public view {
        assertEq(factory.vaultsCount(), 5);
        assertEq(factory.vaultsByOwnerCount(alice), 2);
        assertEq(factory.vaultsByOwnerCount(bob), 2);
        assertEq(factory.vaultsByOwnerCount(carol), 1);
    }

    function test_eachVault_hasCorrectInitialDeposit() public view {
        assertEq(TreasuryVault(vAliceConservative).vaultBalance(), 50_000e6);
        assertEq(TreasuryVault(vAliceBalanced).vaultBalance(), 50_000e6);
        assertEq(TreasuryVault(vBobAggressive).vaultBalance(), 50_000e6);
        assertEq(TreasuryVault(vBobCustom).vaultBalance(), 50_000e6);
        assertEq(TreasuryVault(vCarolBalanced).vaultBalance(), 100_000e6);
    }

    function test_eachVault_hasCorrectOwner() public view {
        assertEq(TreasuryVault(vAliceConservative).owner(), alice);
        assertEq(TreasuryVault(vAliceBalanced).owner(), alice);
        assertEq(TreasuryVault(vBobAggressive).owner(), bob);
        assertEq(TreasuryVault(vBobCustom).owner(), bob);
        assertEq(TreasuryVault(vCarolBalanced).owner(), carol);
    }

    // ── Agent operates on all vaults ─────────────────────────────────────

    function test_agent_canExecuteOnAllVaults_independently() public {
        // Use small amounts so the cumulative pool slippage stays within
        // every vault's slippage cap (Conservative is the tightest at 0.5%).
        // Goal: show the agent can act on each vault, not max out allocations.
        uint256 amt = 1_000e6;

        vm.prank(agent);
        TreasuryVault(vAliceConservative).executeStrategy(
            TreasuryVault.Action.Rebalance, amt, keccak256("p1"), keccak256("a1")
        );
        vm.prank(agent);
        TreasuryVault(vAliceBalanced).executeStrategy(
            TreasuryVault.Action.Rebalance, amt, keccak256("p2"), keccak256("a2")
        );
        vm.prank(agent);
        TreasuryVault(vBobAggressive).executeStrategy(
            TreasuryVault.Action.Rebalance, amt, keccak256("p3"), keccak256("a3")
        );
        vm.prank(agent);
        TreasuryVault(vBobCustom).executeStrategy(
            TreasuryVault.Action.Rebalance, amt, keccak256("p4"), keccak256("a4")
        );
        vm.prank(agent);
        TreasuryVault(vCarolBalanced).executeStrategy(
            TreasuryVault.Action.Rebalance, amt, keccak256("p5"), keccak256("a5")
        );

        // Each vault has exactly 1 execution log
        assertEq(TreasuryVault(vAliceConservative).executionLogCount(), 1);
        assertEq(TreasuryVault(vAliceBalanced).executionLogCount(), 1);
        assertEq(TreasuryVault(vBobAggressive).executionLogCount(), 1);
        assertEq(TreasuryVault(vBobCustom).executionLogCount(), 1);
        assertEq(TreasuryVault(vCarolBalanced).executionLogCount(), 1);

        // Each vault holds some risk asset
        assertGt(TreasuryVault(vAliceConservative).riskBalance(), 0);
        assertGt(TreasuryVault(vAliceBalanced).riskBalance(), 0);
        assertGt(TreasuryVault(vBobAggressive).riskBalance(), 0);
        assertGt(TreasuryVault(vBobCustom).riskBalance(), 0);
        assertGt(TreasuryVault(vCarolBalanced).riskBalance(), 0);
    }

    // ── Per-vault policy enforcement ─────────────────────────────────────

    function test_conservativeVault_rejectsAllocationAboveCap() public {
        // 15% of $50k = $7.5k. Try $10k → should revert.
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.AllocationExceeded.selector);
        TreasuryVault(vAliceConservative).executeStrategy(
            TreasuryVault.Action.Rebalance, 10_000e6, keccak256("p"), keccak256("a")
        );
    }

    function test_aggressiveVault_acceptsHigherAllocation() public {
        // Same $10k that would fail Conservative succeeds in Aggressive
        vm.prank(agent);
        TreasuryVault(vBobAggressive).executeStrategy(
            TreasuryVault.Action.Rebalance, 10_000e6, keccak256("p"), keccak256("a")
        );
        assertEq(TreasuryVault(vBobAggressive).executionLogCount(), 1);
    }

    // ── Per-vault cooldown isolation ─────────────────────────────────────

    function test_cooldown_isolatedPerVault() public {
        // Execute on Aggressive (cooldown 180s)
        vm.prank(agent);
        TreasuryVault(vBobAggressive).executeStrategy(
            TreasuryVault.Action.Rebalance, 1_000e6, keccak256("p1"), keccak256("a1")
        );
        // Same agent, immediately executes on a DIFFERENT vault — must succeed
        vm.prank(agent);
        TreasuryVault(vCarolBalanced).executeStrategy(
            TreasuryVault.Action.Rebalance, 1_000e6, keccak256("p2"), keccak256("a2")
        );
        // But trying again on Aggressive within cooldown — must revert
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.CooldownNotElapsed.selector);
        TreasuryVault(vBobAggressive).executeStrategy(
            TreasuryVault.Action.Rebalance, 1_000e6, keccak256("p3"), keccak256("a3")
        );
    }

    // ── Per-vault pause / kill isolation ─────────────────────────────────

    function test_pause_onOneVault_doesNotAffectOthers() public {
        vm.prank(alice);
        TreasuryVault(vAliceConservative).pause();
        assertTrue(TreasuryVault(vAliceConservative).paused());
        assertFalse(TreasuryVault(vAliceBalanced).paused());
        assertFalse(TreasuryVault(vBobAggressive).paused());
        assertFalse(TreasuryVault(vCarolBalanced).paused());

        // Other vaults still operate
        vm.prank(agent);
        TreasuryVault(vAliceBalanced).executeStrategy(
            TreasuryVault.Action.Rebalance, 1_000e6, keccak256("p"), keccak256("a")
        );
        assertEq(TreasuryVault(vAliceBalanced).executionLogCount(), 1);
    }

    function test_kill_onOneVault_doesNotAffectOthers() public {
        uint256 aliceBalanceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        TreasuryVault(vAliceConservative).emergencyWithdraw();

        assertTrue(TreasuryVault(vAliceConservative).killed());
        assertFalse(TreasuryVault(vAliceBalanced).killed());
        assertFalse(TreasuryVault(vBobAggressive).killed());
        assertGt(usdc.balanceOf(alice), aliceBalanceBefore);

        // Bob still operates
        vm.prank(agent);
        TreasuryVault(vBobAggressive).executeStrategy(
            TreasuryVault.Action.Rebalance, 5_000e6, keccak256("p"), keccak256("a")
        );
        assertEq(TreasuryVault(vBobAggressive).executionLogCount(), 1);
    }

    function test_owner_cannotPauseAnotherVault() public {
        vm.prank(alice);
        vm.expectRevert();
        TreasuryVault(vBobAggressive).pause();
    }

    function test_owner_cannotKillAnotherVault() public {
        vm.prank(alice);
        vm.expectRevert();
        TreasuryVault(vBobAggressive).emergencyWithdraw();
    }

    // ── Per-vault funds isolation ────────────────────────────────────────

    function test_fundsAreIsolated_perVault() public {
        // Each vault holds exactly its own deposit, regardless of others
        assertEq(usdc.balanceOf(vAliceConservative), 50_000e6);
        assertEq(usdc.balanceOf(vAliceBalanced), 50_000e6);
        assertEq(usdc.balanceOf(vBobAggressive), 50_000e6);
        assertEq(usdc.balanceOf(vBobCustom), 50_000e6);
        assertEq(usdc.balanceOf(vCarolBalanced), 100_000e6);
    }

    // ── Agent INFT shared across vaults ──────────────────────────────────

    function test_revokingAgentINFT_freezesAllVaults() public {
        // Single revocation should block agent on every vault (shared identity)
        agentNFT.revoke(0);

        vm.prank(agent);
        vm.expectRevert(TreasuryVault.AgentNotVerified.selector);
        TreasuryVault(vAliceConservative).executeStrategy(
            TreasuryVault.Action.Rebalance, 1_000e6, keccak256("p"), keccak256("a")
        );

        vm.prank(agent);
        vm.expectRevert(TreasuryVault.AgentNotVerified.selector);
        TreasuryVault(vBobAggressive).executeStrategy(
            TreasuryVault.Action.Rebalance, 1_000e6, keccak256("p"), keccak256("a")
        );
    }
}
