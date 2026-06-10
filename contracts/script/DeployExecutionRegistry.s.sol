// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ExecutionRegistry} from "../src/ExecutionRegistry.sol";
import {AgentINFTSignerVerifier, IAgentSignerSource} from "../src/AgentINFTSignerVerifier.sol";

/// @notice Deploy the shared ExecutionRegistry, and (optionally) an
///         AgentINFT-backed verifier if AGENT_NFT_ADDRESS is set. Neither
///         deployment requires any ownership over existing Sentri contracts —
///         the registry is permissionless and additive; the live vault is
///         untouched.
///
/// Env vars:
///   PRIVATE_KEY        — deployer key
///   AGENT_NFT_ADDRESS  — optional; deployed AgentINFT to back the verifier
///
/// Simulate:  forge script script/DeployExecutionRegistry.s.sol --rpc-url og_mainnet
/// Broadcast: add --broadcast
contract DeployExecutionRegistry is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address agentNFT = vm.envOr("AGENT_NFT_ADDRESS", address(0));

        vm.startBroadcast(deployerKey);

        ExecutionRegistry registry = new ExecutionRegistry();
        console2.log("ExecutionRegistry:", address(registry));

        if (agentNFT != address(0)) {
            AgentINFTSignerVerifier verifier = new AgentINFTSignerVerifier(IAgentSignerSource(agentNFT));
            console2.log("AgentINFTSignerVerifier:", address(verifier));
            console2.log("  backed by AgentINFT:", agentNFT);
        } else {
            console2.log("AGENT_NFT_ADDRESS unset - skipping verifier (consumers can use a fixed signer).");
        }

        vm.stopBroadcast();
    }
}
