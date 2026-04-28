// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SentriPair} from "./SentriPair.sol";

/// @title SentriSwapRouter — Thin router over a single SentriPair
/// @notice Uniswap v2–style external interface for add/remove liquidity and swaps.
contract SentriSwapRouter {
    using SafeERC20 for IERC20;

    SentriPair public immutable pair;
    address public immutable token0;
    address public immutable token1;

    error Expired();
    error InsufficientAmountOut();
    error InvalidPath();

    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    constructor(address _pair) {
        pair = SentriPair(_pair);
        token0 = pair.token0();
        token1 = pair.token1();
    }

    // ── Liquidity ────────────────────────────────────────────────────────

    function addLiquidity(
        uint256 amount0,
        uint256 amount1,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 liquidity) {
        IERC20(token0).safeTransferFrom(msg.sender, address(pair), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(pair), amount1);
        liquidity = pair.mint(to);
    }

    // ── Swap ─────────────────────────────────────────────────────────────

    /// @notice Swap an exact `amountIn` of `tokenIn` for at least `amountOutMin` of the other token.
    function swapExactTokensForTokens(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountOut) {
        if (tokenIn != token0 && tokenIn != token1) revert InvalidPath();
        bool zeroForOne = tokenIn == token0;

        (uint112 r0, uint112 r1) = pair.getReserves();
        (uint256 reserveIn, uint256 reserveOut) = zeroForOne ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));

        amountOut = _getAmountOut(amountIn, reserveIn, reserveOut);
        if (amountOut < amountOutMin) revert InsufficientAmountOut();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(pair), amountIn);
        if (zeroForOne) {
            pair.swap(0, amountOut, to);
        } else {
            pair.swap(amountOut, 0, to);
        }
    }

    // ── Quotes ───────────────────────────────────────────────────────────

    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256) {
        (uint112 r0, uint112 r1) = pair.getReserves();
        if (tokenIn == token0) return _getAmountOut(amountIn, r0, r1);
        if (tokenIn == token1) return _getAmountOut(amountIn, r1, r0);
        revert InvalidPath();
    }

    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256)
    {
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        return numerator / denominator;
    }
}
