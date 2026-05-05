// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IJaineV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

interface IJaineV3SwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

/// @title JaineV3PoolAdapter
/// @notice Adapts a single Jaine/Uniswap-V3-style pool to Sentri's simple
///         swapExactTokensForTokens interface. This lets TreasuryVault keep
///         the same router surface on Galileo mocks and 0G mainnet real assets.
contract JaineV3PoolAdapter is IJaineV3SwapCallback {
    using SafeERC20 for IERC20;

    uint160 private constant MIN_SQRT_RATIO_PLUS_ONE = 4295128740;
    uint160 private constant MAX_SQRT_RATIO_MINUS_ONE =
        1461446703485210103287273052203988822378723970341;

    IJaineV3Pool public immutable pool;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;

    error Expired();
    error InvalidPool();
    error InvalidPath();
    error InvalidCallback();
    error InsufficientAmountOut();

    struct CallbackData {
        address payer;
        address tokenIn;
        address tokenOut;
        uint256 amountInMax;
        bytes32 swapId;
    }

    event PoolCallbackPaid(
        bytes32 indexed swapId,
        address indexed payer,
        address indexed tokenIn,
        uint256 amount
    );

    constructor(address _pool) {
        if (_pool == address(0)) revert InvalidPool();
        pool = IJaineV3Pool(_pool);
        token0 = pool.token0();
        token1 = pool.token1();
        fee = pool.fee();
        if (token0 == address(0) || token1 == address(0)) revert InvalidPool();
    }

    /// @notice Swap an exact `amountIn` of `tokenIn` for at least
    ///         `amountOutMin` of the other pool token.
    function swapExactTokensForTokens(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert Expired();
        if (tokenIn != token0 && tokenIn != token1) revert InvalidPath();

        bool zeroForOne = tokenIn == token0;
        address tokenOut = zeroForOne ? token1 : token0;
        bytes32 swapId = keccak256(abi.encodePacked(msg.sender, tokenIn, tokenOut, amountIn, to, deadline, block.number));
        (int256 amount0, int256 amount1) = pool.swap(
            to,
            zeroForOne,
            int256(amountIn),
            zeroForOne ? MIN_SQRT_RATIO_PLUS_ONE : MAX_SQRT_RATIO_MINUS_ONE,
            abi.encode(CallbackData({
                payer: msg.sender,
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountInMax: amountIn,
                swapId: swapId
            }))
        );

        amountOut = uint256(-(zeroForOne ? amount1 : amount0));
        if (amountOut < amountOutMin) revert InsufficientAmountOut();
    }

    /// @notice Uniswap V3-style callback. Pulls the exact input token from the
    ///         caller that approved this adapter, then pays the pool.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _payPool(amount0Delta, amount1Delta, data);
    }

    /// @notice Pancake V3-style callback. Some Jaine deployments use Pancake's
    ///         callback name while keeping the Uniswap V3 swap surface.
    function pancakeV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _payPool(amount0Delta, amount1Delta, data);
    }

    /// @notice Algebra-style callback fallback for V3-compatible pools that use
    ///         a generic swap callback name.
    function algebraSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _payPool(amount0Delta, amount1Delta, data);
    }

    /// @notice Catch-all for Jaine pools compiled with a custom callback
    ///         selector. It is still locked to `pool`, so arbitrary callers
    ///         cannot pull funds through this adapter.
    fallback(bytes calldata input) external returns (bytes memory) {
        if (msg.sender != address(pool)) revert InvalidCallback();
        if (input.length < 100) revert InvalidCallback();
        (int256 amount0Delta, int256 amount1Delta, bytes memory data) =
            abi.decode(input[4:], (int256, int256, bytes));
        _payPool(amount0Delta, amount1Delta, data);
        return "";
    }

    function _payPool(int256 amount0Delta, int256 amount1Delta, bytes memory data) private {
        if (msg.sender != address(pool)) revert InvalidCallback();
        CallbackData memory callback = abi.decode(data, (CallbackData));

        bool payToken0 = amount0Delta > 0 && amount1Delta < 0;
        bool payToken1 = amount1Delta > 0 && amount0Delta < 0;
        if (!payToken0 && !payToken1) revert InvalidCallback();

        address expectedTokenIn = payToken0 ? token0 : token1;
        address expectedTokenOut = payToken0 ? token1 : token0;
        if (callback.tokenIn != expectedTokenIn || callback.tokenOut != expectedTokenOut) revert InvalidPath();
        if (callback.payer == address(0)) revert InvalidCallback();

        uint256 amountToPay = payToken0 ? uint256(amount0Delta) : uint256(amount1Delta);
        if (amountToPay == 0 || amountToPay > callback.amountInMax) revert InvalidCallback();

        IERC20(callback.tokenIn).safeTransferFrom(callback.payer, msg.sender, amountToPay);
        emit PoolCallbackPaid(callback.swapId, callback.payer, callback.tokenIn, amountToPay);
    }
}
