// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");

        TreasuryVault.Policy memory policy = TreasuryVault.Policy({
            maxAllocationBps: 2000,       // 20%
            maxDrawdownBps: 1000,         // 10%
            rebalanceThresholdBps: 500,   // 5%
            cooldownPeriod: 300           // 5 minutes
        });

        vm.startBroadcast(deployerKey);

        MockUSDC usdc = new MockUSDC();
        console2.log("MockUSDC deployed at:", address(usdc));

        TreasuryVault vault = new TreasuryVault(
            address(usdc),
            agent,
            policy
        );
        console2.log("TreasuryVault deployed at:", address(vault));

        // Mint 1M USDC to deployer for testing
        usdc.mint(vm.addr(deployerKey), 1_000_000e6);
        console2.log("Minted 1M USDC to deployer");

        vm.stopBroadcast();
    }
}
