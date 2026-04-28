// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {SentriPair} from "../src/SentriPair.sol";
import {SentriSwapRouter} from "../src/SentriSwapRouter.sol";
import {SentriPriceFeed} from "../src/SentriPriceFeed.sol";

contract TreasuryVaultTest is Test {
    MockUSDC usdc;
    MockWETH weth;
    AgentINFT agentNFT;
    SentriPair pair;
    SentriSwapRouter router;
    SentriPriceFeed feed;
    TreasuryVault vault;

    address owner = address(this);
    address agent = makeAddr("agent");
    address alice = makeAddr("alice");
    address lper = makeAddr("lper");

    TreasuryVault.Policy defaultPolicy;

    // Oracle: 1 WETH = 2000 USDC, feed decimals = 8, so price raw = 2000 * 1e8
    int256 constant PRICE = 2000 * 1e8;

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockWETH();
        agentNFT = new AgentINFT();

        feed = new SentriPriceFeed(8, "WETH/USDC");
        feed.setKeeper(address(this), true);
        feed.pushAnswer(PRICE, keccak256("att-0"));

        // Pair ordered deterministically by address
        (address t0, address t1) = address(usdc) < address(weth)
            ? (address(usdc), address(weth))
            : (address(weth), address(usdc));
        pair = new SentriPair(t0, t1);
        router = new SentriSwapRouter(address(pair));

        // Seed LP: 1,000,000 USDC + 500 WETH → 1 WETH = 2000 USDC
        usdc.mint(lper, 1_000_000e6);
        weth.mint(lper, 500e18);
        vm.startPrank(lper);
        usdc.approve(address(router), type(uint256).max);
        weth.approve(address(router), type(uint256).max);
        (uint256 a0, uint256 a1) = t0 == address(usdc)
            ? (uint256(1_000_000e6), uint256(500e18))
            : (uint256(500e18), uint256(1_000_000e6));
        router.addLiquidity(a0, a1, lper, block.timestamp + 1);
        vm.stopPrank();

        defaultPolicy = TreasuryVault.Policy({
            maxAllocationBps: 2000,        // 20%
            maxDrawdownBps: 1000,          // 10%
            rebalanceThresholdBps: 500,    // 5%
            maxSlippageBps: 300,           // 3%
            cooldownPeriod: 60,
            maxPriceStaleness: 3600
        });

        vault = new TreasuryVault(
            address(usdc),
            address(weth),
            address(agentNFT),
            address(router),
            address(feed),
            agent,
            defaultPolicy
        );

        agentNFT.mint(agent, keccak256("enclave-v1"), keccak256("att-v1"), "0G Sealed Inference");

        usdc.mint(alice, 100_000e6);
    }

    // ── Deposit ──────────────────────────────────────────────────────────

    function test_deposit_updatesHighWaterMark() public {
        _depositAs(alice, 10_000e6);
        assertEq(vault.vaultBalance(), 10_000e6);
        assertEq(vault.highWaterMark(), 10_000e6);
    }

    function test_deposit_reverts_zero() public {
        vm.prank(alice);
        vm.expectRevert(TreasuryVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_deposit_reverts_whenKilled() public {
        vault.emergencyWithdraw();
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert(TreasuryVault.VaultKilled.selector);
        vault.deposit(1_000e6);
        vm.stopPrank();
    }

    // ── Execute: base → risk (Rebalance) ─────────────────────────────────

    function test_executeStrategy_swapsBaseToRisk() public {
        _depositAs(alice, 10_000e6);

        uint256 usdcBefore = vault.vaultBalance();
        uint256 wethBefore = vault.riskBalance();

        vm.prank(agent);
        vault.executeStrategy(TreasuryVault.Action.Rebalance, 1_000e6, keccak256("p"), keccak256("a"));

        assertEq(vault.vaultBalance(), usdcBefore - 1_000e6);
        assertGt(vault.riskBalance(), wethBefore);
        assertEq(vault.executionLogCount(), 1);
    }

    function test_executeStrategy_reverts_allocationExceeded() public {
        _depositAs(alice, 10_000e6);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.AllocationExceeded.selector);
        vault.executeStrategy(TreasuryVault.Action.Rebalance, 3_000e6, keccak256("p"), keccak256("a"));
    }

    function test_executeStrategy_reverts_cooldown() public {
        _depositAs(alice, 10_000e6);
        vm.prank(agent);
        vault.executeStrategy(TreasuryVault.Action.Rebalance, 500e6, keccak256("p1"), keccak256("a1"));
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.CooldownNotElapsed.selector);
        vault.executeStrategy(TreasuryVault.Action.Rebalance, 500e6, keccak256("p2"), keccak256("a2"));
    }

    function test_executeStrategy_succeeds_afterCooldown() public {
        _depositAs(alice, 10_000e6);
        vm.prank(agent);
        vault.executeStrategy(TreasuryVault.Action.Rebalance, 500e6, keccak256("p1"), keccak256("a1"));
        vm.warp(block.timestamp + 61);
        vm.prank(agent);
        vault.executeStrategy(TreasuryVault.Action.YieldFarm, 500e6, keccak256("p2"), keccak256("a2"));
        assertEq(vault.executionLogCount(), 2);
    }

    // ── Execute: risk → base (Deleverage) ────────────────────────────────

    function test_executeStrategy_deleverage() public {
        _depositAs(alice, 10_000e6);
        // Open a position first
        vm.prank(agent);
        vault.executeStrategy(TreasuryVault.Action.Rebalance, 1_000e6, keccak256("p"), keccak256("a"));

        vm.warp(block.timestamp + 61);

        uint256 wethBal = vault.riskBalance();
        assertGt(wethBal, 0);

        vm.prank(agent);
        vault.executeStrategy(TreasuryVault.Action.EmergencyDeleverage, wethBal / 2, keccak256("p2"), keccak256("a2"));
        assertLt(vault.riskBalance(), wethBal);
    }

    // ── Oracle / slippage ────────────────────────────────────────────────

    function test_executeStrategy_reverts_priceStale() public {
        _depositAs(alice, 10_000e6);
        vm.warp(block.timestamp + 7200); // staleness = 3600
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.PriceStale.selector);
        vault.executeStrategy(TreasuryVault.Action.Rebalance, 500e6, keccak256("p"), keccak256("a"));
    }

    function test_executeStrategy_reverts_slippage_whenOracleTooFar() public {
        _depositAs(alice, 10_000e6);
        // Move oracle to pretend 1 WETH = 100 USDC (way off from pool's 2000).
        // Pool will give ~0.5 WETH for 1000 USDC, but oracle expects ~10 WETH,
        // so minOut > actualOut → router reverts on slippage.
        feed.pushAnswer(100 * 1e8, keccak256("att-drift"));
        vm.prank(agent);
        vm.expectRevert(SentriSwapRouter.InsufficientAmountOut.selector);
        vault.executeStrategy(TreasuryVault.Action.Rebalance, 1_000e6, keccak256("p"), keccak256("a"));
    }

    // ── Kill-switch ──────────────────────────────────────────────────────

    function test_emergencyWithdraw_drainsBoth() public {
        _depositAs(alice, 10_000e6);
        vm.prank(agent);
        vault.executeStrategy(TreasuryVault.Action.Rebalance, 1_000e6, keccak256("p"), keccak256("a"));

        uint256 usdcBefore = usdc.balanceOf(owner);
        uint256 wethBefore = weth.balanceOf(owner);
        vault.emergencyWithdraw();
        assertEq(vault.killed(), true);
        assertEq(vault.vaultBalance(), 0);
        assertEq(vault.riskBalance(), 0);
        assertGt(usdc.balanceOf(owner), usdcBefore);
        assertGt(weth.balanceOf(owner), wethBefore);
    }

    // ── Admin ────────────────────────────────────────────────────────────

    function test_setPolicy() public {
        TreasuryVault.Policy memory p = TreasuryVault.Policy({
            maxAllocationBps: 3000,
            maxDrawdownBps: 1500,
            rebalanceThresholdBps: 300,
            maxSlippageBps: 200,
            cooldownPeriod: 120,
            maxPriceStaleness: 1800
        });
        vault.setPolicy(p);
        (uint16 alloc,,,,, ) = vault.policy();
        assertEq(alloc, 3000);
    }

    function test_setPolicy_reverts_invalid() public {
        TreasuryVault.Policy memory bad = TreasuryVault.Policy({
            maxAllocationBps: 0,
            maxDrawdownBps: 1000,
            rebalanceThresholdBps: 500,
            maxSlippageBps: 300,
            cooldownPeriod: 60,
            maxPriceStaleness: 3600
        });
        vm.expectRevert(TreasuryVault.InvalidPolicy.selector);
        vault.setPolicy(bad);
    }

    // ── AgentINFT gating ─────────────────────────────────────────────────

    function test_revokedAgent_cannotExecute() public {
        _depositAs(alice, 10_000e6);
        agentNFT.revoke(0);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.AgentNotVerified.selector);
        vault.executeStrategy(TreasuryVault.Action.Rebalance, 500e6, keccak256("p"), keccak256("a"));
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    function _depositAs(address user, uint256 amount) internal {
        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }
}
