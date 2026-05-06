// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// @notice Lightweight redeploy of just TreasuryVault impl + VaultFactory.
///         Reuses existing AgentINFT, PriceFeed, Router/Adapter, base/risk
///         tokens — no need to redeploy expensive dependencies.
///
///         Use cases:
///         - Bumping factory presets (e.g. cooldown changes)
///         - Bumping vault impl logic without re-onboarding the agent INFT
///
///         Deployer must already be configured as keeper on the existing
///         price feed and the agent must already hold an active INFT.
///         Creates one Aggressive demo vault owned by the deployer for
///         immediate verification (Aggressive = 60s cooldown floor).
contract RedeployFactory is Script {
    function run() external {
        // PRIVATE_KEY_MAINNET takes precedence when set (mainnet runs); falls
        // back to PRIVATE_KEY for Galileo / dev runs. Read via envBytes32 so
        // the script tolerates both 0x-prefixed and bare hex private keys.
        uint256 deployerKey = vm.envExists("PRIVATE_KEY_MAINNET")
            ? uint256(vm.envBytes32("PRIVATE_KEY_MAINNET"))
            : uint256(vm.envBytes32("PRIVATE_KEY"));
        require(deployerKey != 0, "no deployer key configured");
        address agent = vm.envAddress("AGENT_ADDRESS");
        address agentNFT = vm.envAddress("AGENT_INFT_ADDRESS");
        address router = vm.envAddress("ROUTER_ADDRESS");
        address priceFeed = vm.envAddress("PRICE_FEED_ADDRESS");
        address base = vm.envAddress("BASE_TOKEN_ADDRESS");
        address risk = vm.envAddress("RISK_TOKEN_ADDRESS");

        vm.startBroadcast(deployerKey);

        TreasuryVault vaultImpl = new TreasuryVault();
        console2.log("TreasuryVault impl:", address(vaultImpl));

        VaultFactory factory = new VaultFactory(
            address(vaultImpl),
            agent,
            agentNFT,
            router,
            priceFeed,
            base,
            risk
        );
        console2.log("VaultFactory:      ", address(factory));

        address demoVault = factory.createVault(VaultFactory.PresetTier.Aggressive);
        console2.log("Demo vault:        ", demoVault);

        vm.stopBroadcast();
    }
}
