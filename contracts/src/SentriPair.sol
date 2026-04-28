// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title SentriPair — Minimal Uniswap v2 constant-product AMM pair
/// @notice Single pair for token0/token1 with 0.3% fee. LP token is this contract.
contract SentriPair is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 private constant FEE_NUM = 997;
    uint256 private constant FEE_DEN = 1000;

    address public immutable token0;
    address public immutable token1;

    uint112 private reserve0;
    uint112 private reserve1;

    error InsufficientLiquidity();
    error InsufficientInput();
    error InsufficientOutput();
    error KInvariant();

    event Mint(address indexed to, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Burn(address indexed to, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Swap(
        address indexed to,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    constructor(address _token0, address _token1) ERC20("Sentri LP", "SLP") {
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves() public view returns (uint112, uint112) {
        return (reserve0, reserve1);
    }

    /// @notice Mint LP tokens against the delta between current balance and stored reserves.
    ///         Caller must transfer tokens in before calling.
    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        (uint112 r0, uint112 r1) = (reserve0, reserve1);
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        uint256 a0 = b0 - r0;
        uint256 a1 = b1 - r1;

        uint256 _total = totalSupply();
        if (_total == 0) {
            liquidity = Math.sqrt(a0 * a1) - MINIMUM_LIQUIDITY;
            _mint(address(1), MINIMUM_LIQUIDITY); // lock
        } else {
            liquidity = Math.min((a0 * _total) / r0, (a1 * _total) / r1);
        }
        if (liquidity == 0) revert InsufficientLiquidity();
        _mint(to, liquidity);

        _update(b0, b1);
        emit Mint(to, a0, a1, liquidity);
    }

    /// @notice Burn LP tokens from this contract and send underlying to `to`.
    ///         Caller must transfer the LP tokens in before calling.
    function burn(address to) external nonReentrant returns (uint256 a0, uint256 a1) {
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));
        uint256 _total = totalSupply();

        a0 = (liquidity * b0) / _total;
        a1 = (liquidity * b1) / _total;
        if (a0 == 0 || a1 == 0) revert InsufficientLiquidity();

        _burn(address(this), liquidity);
        IERC20(token0).safeTransfer(to, a0);
        IERC20(token1).safeTransfer(to, a1);

        b0 = IERC20(token0).balanceOf(address(this));
        b1 = IERC20(token1).balanceOf(address(this));
        _update(b0, b1);
        emit Burn(to, a0, a1, liquidity);
    }

    /// @notice Low-level swap. Caller must have transferred the input amount in first.
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external nonReentrant {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutput();
        (uint112 r0, uint112 r1) = (reserve0, reserve1);
        if (amount0Out >= r0 || amount1Out >= r1) revert InsufficientLiquidity();

        if (amount0Out > 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).safeTransfer(to, amount1Out);

        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        uint256 in0 = b0 > r0 - amount0Out ? b0 - (r0 - amount0Out) : 0;
        uint256 in1 = b1 > r1 - amount1Out ? b1 - (r1 - amount1Out) : 0;
        if (in0 == 0 && in1 == 0) revert InsufficientInput();

        // K invariant with 0.3% fee on inputs
        uint256 b0Adj = b0 * FEE_DEN - in0 * (FEE_DEN - FEE_NUM);
        uint256 b1Adj = b1 * FEE_DEN - in1 * (FEE_DEN - FEE_NUM);
        if (b0Adj * b1Adj < uint256(r0) * uint256(r1) * (FEE_DEN * FEE_DEN)) revert KInvariant();

        _update(b0, b1);
        emit Swap(to, in0, in1, amount0Out, amount1Out);
    }

    function _update(uint256 b0, uint256 b1) private {
        require(b0 <= type(uint112).max && b1 <= type(uint112).max, "overflow");
        reserve0 = uint112(b0);
        reserve1 = uint112(b1);
        emit Sync(reserve0, reserve1);
    }
}
