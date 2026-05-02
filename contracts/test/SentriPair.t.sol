// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {SentriPair} from "../src/SentriPair.sol";
import {SentriSwapRouter} from "../src/SentriSwapRouter.sol";

/// @dev Tests the constant-product AMM directly (low-level mint/burn/swap)
///      and through the router. Token order is normalized so token0 < token1
///      regardless of which mock has the lower address — same convention the
///      router uses.
contract SentriPairTest is Test {
    MockUSDC usdc;
    MockWETH weth;
    SentriPair pair;
    SentriSwapRouter router;

    address lper = makeAddr("lper");
    address trader = makeAddr("trader");

    address t0;
    address t1;

    // Initial liquidity: 1M USDC + 500 WETH → 1 WETH = 2000 USDC
    uint256 constant USDC_LIQ = 1_000_000e6;
    uint256 constant WETH_LIQ = 500e18;

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockWETH();
        (t0, t1) = address(usdc) < address(weth)
            ? (address(usdc), address(weth))
            : (address(weth), address(usdc));
        pair = new SentriPair(t0, t1);
        router = new SentriSwapRouter(address(pair));

        usdc.mint(lper, USDC_LIQ);
        weth.mint(lper, WETH_LIQ);
        vm.startPrank(lper);
        usdc.approve(address(router), type(uint256).max);
        weth.approve(address(router), type(uint256).max);
        (uint256 a0, uint256 a1) = t0 == address(usdc)
            ? (USDC_LIQ, WETH_LIQ)
            : (WETH_LIQ, USDC_LIQ);
        router.addLiquidity(a0, a1, lper, block.timestamp + 1);
        vm.stopPrank();
    }

    function test_initialLiquidity_setsReserves() public view {
        (uint112 r0, uint112 r1) = pair.getReserves();
        (uint256 expected0, uint256 expected1) = t0 == address(usdc)
            ? (USDC_LIQ, WETH_LIQ)
            : (WETH_LIQ, USDC_LIQ);
        assertEq(uint256(r0), expected0);
        assertEq(uint256(r1), expected1);
    }

    function test_initialLiquidity_locksMinimumLiquidity() public view {
        // address(1) holds the locked MINIMUM_LIQUIDITY = 1000
        assertEq(pair.balanceOf(address(1)), 1000);
        // LP gets sqrt(a0 * a1) - 1000
        uint256 expected = sqrt_(USDC_LIQ * WETH_LIQ) - 1000;
        assertEq(pair.balanceOf(lper), expected);
    }

    function test_swap_throughRouter_basePathRespectsK() public {
        uint256 amountIn = 2000e6; // 2000 USDC
        usdc.mint(trader, amountIn);

        (uint112 r0Before, uint112 r1Before) = pair.getReserves();
        uint256 kBefore = uint256(r0Before) * uint256(r1Before);

        vm.startPrank(trader);
        usdc.approve(address(router), amountIn);
        uint256 amountOut = router.swapExactTokensForTokens(
            address(usdc),
            amountIn,
            0,
            trader,
            block.timestamp + 1
        );
        vm.stopPrank();

        // Out positive and below the no-fee theoretical max
        assertGt(amountOut, 0);
        assertEq(weth.balanceOf(trader), amountOut);

        (uint112 r0After, uint112 r1After) = pair.getReserves();
        uint256 kAfter = uint256(r0After) * uint256(r1After);
        // K must grow (or stay equal in edge case) with the 0.3% fee accruing in reserves.
        assertGe(kAfter, kBefore, "K invariant must not decrease");
    }

    function test_swap_reverseDirection_alsoWorks() public {
        uint256 amountIn = 1e18; // 1 WETH
        weth.mint(trader, amountIn);

        vm.startPrank(trader);
        weth.approve(address(router), amountIn);
        uint256 amountOut = router.swapExactTokensForTokens(
            address(weth),
            amountIn,
            0,
            trader,
            block.timestamp + 1
        );
        vm.stopPrank();

        // Roughly 2000 USDC out (with fee + small slippage). Allow a wide band — sanity only.
        assertGt(amountOut, 1900e6, "out too low");
        assertLt(amountOut, 2000e6, "out too high (no fee)");
    }

    function test_swap_revertsWhenSlippageNotMet() public {
        uint256 amountIn = 2000e6;
        usdc.mint(trader, amountIn);
        vm.startPrank(trader);
        usdc.approve(address(router), amountIn);

        // Demand impossible amountOutMin
        vm.expectRevert(SentriSwapRouter.InsufficientAmountOut.selector);
        router.swapExactTokensForTokens(
            address(usdc),
            amountIn,
            10e18, // way too high for 2000 USDC at 1 WETH=2000 USDC
            trader,
            block.timestamp + 1
        );
        vm.stopPrank();
    }

    function test_swap_revertsWhenDeadlineExpired() public {
        uint256 amountIn = 100e6;
        usdc.mint(trader, amountIn);
        vm.startPrank(trader);
        usdc.approve(address(router), amountIn);
        vm.expectRevert(SentriSwapRouter.Expired.selector);
        router.swapExactTokensForTokens(
            address(usdc),
            amountIn,
            0,
            trader,
            block.timestamp - 1
        );
        vm.stopPrank();
    }

    function test_swap_lowLevel_revertsOnZeroOutput() public {
        vm.expectRevert(SentriPair.InsufficientOutput.selector);
        pair.swap(0, 0, trader);
    }

    function test_addLiquidity_proportional_mintsLpProportional() public {
        // Add 10% on top of existing reserves
        uint256 add0 = USDC_LIQ / 10;
        uint256 add1 = WETH_LIQ / 10;
        usdc.mint(lper, add0);
        weth.mint(lper, add1);

        uint256 lpBefore = pair.balanceOf(lper);

        vm.startPrank(lper);
        (uint256 a0, uint256 a1) = t0 == address(usdc) ? (add0, add1) : (add1, add0);
        router.addLiquidity(a0, a1, lper, block.timestamp + 1);
        vm.stopPrank();

        uint256 lpAfter = pair.balanceOf(lper);
        uint256 minted = lpAfter - lpBefore;
        // ~10% growth in supply minus the minimum-liquidity dilution
        uint256 totalLp = pair.totalSupply();
        // minted should be roughly totalLp / 11 (since we added 10% to existing 100%)
        assertGt(minted, totalLp / 12);
        assertLt(minted, totalLp / 10);
    }

    // ── small helpers ───────────────────────────────────────────────────

    function sqrt_(uint256 y) private pure returns (uint256 z) {
        // OpenZeppelin Math.sqrt clone (small-input version)
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
