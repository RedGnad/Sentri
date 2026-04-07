// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC — Testnet stablecoin with public mint
/// @notice 6 decimals, anyone can mint for testing purposes
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint tokens to any address (testnet only)
    /// @param to Recipient address
    /// @param amount Amount in smallest unit (6 decimals)
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
