// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ExecutionRegistry} from "../src/ExecutionRegistry.sol";
import {FullStackAttestedConsumer} from "../src/examples/FullStackAttestedConsumer.sol";

/// @notice Deploy the headline full-stack reference consumer, wired to a deployed
///         ExecutionRegistry and the live Pyth pull-oracle. It registers itself
///         with the registry in its constructor. Reference example; owns no funds.
///
/// Env vars:
///   PRIVATE_KEY            — deployer key (becomes the consumer owner)
///   REGISTRY_ADDRESS       — deployed ExecutionRegistry
///   CONSUMER_SIGNER        — authorised signer for this consumer's receipts
///   PYTH_CONTRACT_ADDRESS  — Pyth pull-oracle on 0G
///   PYTH_PRICE_ID          — Pyth feed id (e.g. 0G/USD)
///   PYTH_MAX_AGE           — optional, default 60 (<= 300)
///   PYTH_MAX_CONF_BPS      — optional, default 200 (<= 1000)
///   CONSUMER_COOLDOWN      — optional, default 0
///
/// Simulate:  forge script script/DeployFullStackConsumer.s.sol --rpc-url og_mainnet
/// Broadcast: add --broadcast
contract DeployFullStackConsumer is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address registry = vm.envAddress("REGISTRY_ADDRESS");
        address signer = vm.envAddress("CONSUMER_SIGNER");
        address pyth = vm.envAddress("PYTH_CONTRACT_ADDRESS");
        bytes32 priceId = vm.envBytes32("PYTH_PRICE_ID");
        uint256 maxAge = vm.envOr("PYTH_MAX_AGE", uint256(60));
        uint256 maxConfBps = vm.envOr("PYTH_MAX_CONF_BPS", uint256(200));
        uint256 cooldown = vm.envOr("CONSUMER_COOLDOWN", uint256(0));

        vm.startBroadcast(deployerKey);

        FullStackAttestedConsumer consumer = new FullStackAttestedConsumer(
            ExecutionRegistry(registry),
            signer,
            uint64(cooldown),
            pyth,
            priceId,
            maxAge,
            maxConfBps
        );

        console2.log("FullStackAttestedConsumer:", address(consumer));
        console2.log("  registry:", registry);
        console2.log("  pyth:", pyth);

        vm.stopBroadcast();
    }
}
