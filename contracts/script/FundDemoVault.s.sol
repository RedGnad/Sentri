// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";
import {JaineV3PoolAdapter} from "../src/JaineV3PoolAdapter.sol";

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256) external;
    function balanceOf(address) external view returns (uint256);
}

/// @notice One-shot demo vault funding pipeline for 0G mainnet:
///         1. Wrap native OG → W0G via W0G.deposit{value}()
///         2. Approve Jaine adapter, swap W0G → USDC.E
///         3. Approve the vault, deposit USDC.E
///
///         Reads env vars:
///         - PRIVATE_KEY_MAINNET (preferred) or PRIVATE_KEY (fallback)
///         - VAULT_ADDRESS                  : target vault to fund
///         - W0G_ADDRESS                    : wrapped 0G token
///         - USDCE_ADDRESS                  : USDC.E token
///         - JAINE_ADAPTER_ADDRESS          : router/adapter for swap
///         - WRAP_AMOUNT_WEI                : amount of OG to wrap (in wei)
///         - SWAP_AMOUNT_WEI (optional)     : W0G amount to swap (default = WRAP_AMOUNT_WEI)
///         - MIN_USDCE_OUT (optional)       : minimum USDC.E to receive (default 0 = no slippage guard)
///         - DEPOSIT_AMOUNT_USDCE (optional): USDC.E amount to deposit (default = entire received)
contract FundDemoVault is Script {
    using SafeERC20 for IERC20;

    function run() external {
        uint256 deployerKey = vm.envExists("PRIVATE_KEY_MAINNET")
            ? uint256(vm.envBytes32("PRIVATE_KEY_MAINNET"))
            : uint256(vm.envBytes32("PRIVATE_KEY"));
        require(deployerKey != 0, "no deployer key configured");

        address vault = vm.envAddress("VAULT_ADDRESS");
        address w0gAddr = vm.envAddress("W0G_ADDRESS");
        address usdceAddr = vm.envAddress("USDCE_ADDRESS");
        address adapterAddr = vm.envAddress("JAINE_ADAPTER_ADDRESS");
        uint256 wrapAmount = vm.envUint("WRAP_AMOUNT_WEI");
        uint256 swapAmount = vm.envOr("SWAP_AMOUNT_WEI", wrapAmount);
        uint256 minUsdceOut = vm.envOr("MIN_USDCE_OUT", uint256(0));

        IWrappedNative w0g = IWrappedNative(w0gAddr);
        IERC20 usdce = IERC20(usdceAddr);
        JaineV3PoolAdapter adapter = JaineV3PoolAdapter(payable(adapterAddr));
        TreasuryVault treasury = TreasuryVault(vault);

        address sender = vm.addr(deployerKey);
        console2.log("Sender:           ", sender);
        console2.log("Vault:            ", vault);
        console2.log("Wrap amount (OG): ", wrapAmount);

        vm.startBroadcast(deployerKey);

        // 1. Wrap OG → W0G
        uint256 w0gBefore = w0g.balanceOf(sender);
        w0g.deposit{value: wrapAmount}();
        uint256 w0gAfter = w0g.balanceOf(sender);
        console2.log("W0G received:     ", w0gAfter - w0gBefore);

        // 2. Approve adapter and swap W0G → USDC.E
        IERC20(w0gAddr).forceApprove(adapterAddr, swapAmount);
        uint256 usdceBefore = usdce.balanceOf(sender);
        adapter.swapExactTokensForTokens(
            w0gAddr,
            swapAmount,
            minUsdceOut,
            sender,
            block.timestamp + 600
        );
        uint256 usdceReceived = usdce.balanceOf(sender) - usdceBefore;
        console2.log("USDC.E received:  ", usdceReceived);

        // 3. Approve vault and deposit USDC.E
        uint256 depositAmount = vm.envOr("DEPOSIT_AMOUNT_USDCE", usdceReceived);
        require(depositAmount <= usdceReceived, "deposit > received");
        usdce.forceApprove(vault, depositAmount);
        treasury.deposit(depositAmount);

        console2.log("Deposited:        ", depositAmount);

        vm.stopBroadcast();
    }
}
