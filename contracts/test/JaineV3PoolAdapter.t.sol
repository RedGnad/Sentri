// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {JaineV3PoolAdapter} from "../src/JaineV3PoolAdapter.sol";

contract MockJaineV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public constant fee = 3000;

    bool public useCustomSelector;
    int256 public nextAmount0Delta;
    int256 public nextAmount1Delta;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    function setCallback(bool customSelector, int256 amount0Delta, int256 amount1Delta) external {
        useCustomSelector = customSelector;
        nextAmount0Delta = amount0Delta;
        nextAmount1Delta = amount1Delta;
    }

    function swap(
        address recipient,
        bool zeroForOne,
        int256,
        uint160,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1) {
        amount0 = nextAmount0Delta;
        amount1 = nextAmount1Delta;

        bytes memory callData = useCustomSelector
            ? abi.encodeWithSelector(bytes4(0xbdbc4d56), amount0, amount1, data)
            : abi.encodeWithSelector(
                bytes4(keccak256("uniswapV3SwapCallback(int256,int256,bytes)")),
                amount0,
                amount1,
                data
            );

        (bool ok, bytes memory ret) = msg.sender.call(callData);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }

        uint256 out = uint256(-(zeroForOne ? amount1 : amount0));
        IERC20(zeroForOne ? token1 : token0).transfer(recipient, out);
    }
}

contract JaineV3PoolAdapterTest is Test {
    MockUSDC usdc;
    MockWETH weth;
    MockJaineV3Pool pool;
    JaineV3PoolAdapter adapter;

    address trader = makeAddr("trader");
    address attacker = makeAddr("attacker");

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockWETH();
        pool = new MockJaineV3Pool(address(usdc), address(weth));
        adapter = new JaineV3PoolAdapter(address(pool));

        usdc.mint(trader, 10_000e6);
        weth.mint(address(pool), 10e18);
        usdc.mint(address(pool), 10_000e6);
        weth.mint(trader, 10e18);
    }

    function test_customSelectorCallback_paysPoolAndSendsOutput() public {
        uint256 amountIn = 100e6;
        uint256 amountOut = 1e18;
        pool.setCallback(true, int256(amountIn), -int256(amountOut));

        vm.startPrank(trader);
        usdc.approve(address(adapter), amountIn);
        uint256 out = adapter.swapExactTokensForTokens(
            address(usdc),
            amountIn,
            amountOut,
            trader,
            block.timestamp + 1
        );
        vm.stopPrank();

        assertEq(out, amountOut);
        assertEq(usdc.balanceOf(address(pool)), 10_000e6 + amountIn);
        assertEq(weth.balanceOf(trader), 11e18);
    }

    function test_uniswapSelectorCallback_paysPoolAndSendsOutput() public {
        uint256 amountIn = 1e18;
        uint256 amountOut = 100e6;
        pool.setCallback(false, -int256(amountOut), int256(amountIn));

        vm.startPrank(trader);
        weth.approve(address(adapter), amountIn);
        uint256 out = adapter.swapExactTokensForTokens(
            address(weth),
            amountIn,
            amountOut,
            trader,
            block.timestamp + 1
        );
        vm.stopPrank();

        assertEq(out, amountOut);
        assertEq(weth.balanceOf(address(pool)), 11e18);
        assertEq(usdc.balanceOf(trader), 10_100e6);
    }

    function test_callbackFromNonPool_reverts() public {
        vm.prank(attacker);
        vm.expectRevert(JaineV3PoolAdapter.InvalidCallback.selector);
        adapter.uniswapV3SwapCallback(int256(1), -int256(1), "");
    }

    function test_callbackWithBothPositiveDeltas_reverts() public {
        uint256 amountIn = 100e6;
        pool.setCallback(true, int256(amountIn), int256(1));

        vm.startPrank(trader);
        usdc.approve(address(adapter), amountIn);
        vm.expectRevert(JaineV3PoolAdapter.InvalidCallback.selector);
        adapter.swapExactTokensForTokens(address(usdc), amountIn, 0, trader, block.timestamp + 1);
        vm.stopPrank();
    }

    function test_callbackCannotPullMoreThanAmountInMax() public {
        uint256 amountIn = 100e6;
        pool.setCallback(true, int256(amountIn + 1), -int256(1e18));

        vm.startPrank(trader);
        usdc.approve(address(adapter), amountIn + 1);
        vm.expectRevert(JaineV3PoolAdapter.InvalidCallback.selector);
        adapter.swapExactTokensForTokens(address(usdc), amountIn, 0, trader, block.timestamp + 1);
        vm.stopPrank();
    }
}
