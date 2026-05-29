// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TreasuryVaultTrustlessOracle} from "../src/TreasuryVaultTrustlessOracle.sol";
import {VaultFactoryV2} from "../src/VaultFactoryV2.sol";

/// @notice Option-(b) ISOLATED canary deploy on 0G mainnet, signed by the
///         CANARY key (not the AgentINFT owner). It deploys only the parts that
///         do NOT require ownership:
///           1. TreasuryVaultTrustlessOracle implementation
///           2. VaultFactoryV2
///           (3. createVault — gated by DEPLOY_CREATE_VAULT, see note below)
///
///         It deliberately does NOT call AgentINFT.setAuthorizedFactory
///         (onlyOwner). That single authorization tx must be sent separately by
///         the owner 0x981F… AFTER this script, and BEFORE createVault — because
///         VaultFactoryV2._deployVault only calls authorizeUsageFromFactory when
///         the factory is already authorized. A vault created before the owner
///         authorization is NOT agent-operable.
///
///         Correct option-(b) sequence:
///           A. [canary] this script with DEPLOY_CREATE_VAULT=false → impl + factory
///           B. [owner ] setAuthorizedFactory(factory, true)   (single tx)
///           C. [canary] createVault on the now-authorized factory
///
/// Env vars:
///   PRIVATE_KEY            — canary deployer key
///   AGENT_ADDRESS          — agent operator (INFT holder; 0x981F…)
///   AGENT_NFT_ADDRESS      — deployed AgentINFT
///   ROUTER_ADDRESS         — SentriSwapRouter / JaineV3PoolAdapter
///   BASE_TOKEN_ADDRESS     — USDC.e
///   RISK_TOKEN_ADDRESS     — W0G
///   AGENT_TOKEN_ID         — agent's INFT token id (0)
///   PYTH_CONTRACT_ADDRESS  — 0x2880aB155794e7179c9eE2e38200202908C17B43
///   PYTH_PRICE_ID          — 0G/USD feed
///   DEPLOY_CREATE_VAULT    — "true" (default) creates a Balanced vault; "false" stops after the factory
///
/// Usage (simulate): forge script script/DeployTrustlessOracleCanary.s.sol --rpc-url og_mainnet
/// Usage (broadcast): add --broadcast
contract DeployTrustlessOracleCanary is Script {
    function run() external {
        uint256 deployerKey  = vm.envUint("PRIVATE_KEY");
        address deployer     = vm.addr(deployerKey);
        address agentAddr    = vm.envAddress("AGENT_ADDRESS");
        address agentNFT     = vm.envAddress("AGENT_NFT_ADDRESS");
        address router       = vm.envAddress("ROUTER_ADDRESS");
        address baseToken    = vm.envAddress("BASE_TOKEN_ADDRESS");
        address riskToken    = vm.envAddress("RISK_TOKEN_ADDRESS");
        uint256 agentTokenId = vm.envUint("AGENT_TOKEN_ID");
        address pythContract = vm.envAddress("PYTH_CONTRACT_ADDRESS");
        bytes32 pythPriceId  = vm.envBytes32("PYTH_PRICE_ID");
        bool createVaultStep = _envBoolOr("DEPLOY_CREATE_VAULT", true);

        console2.log("=== Sentri Trustless Oracle CANARY deploy (option b) - 0G mainnet ===");
        console2.log("Deployer (canary):", deployer);
        console2.log("Agent (operator) :", agentAddr);
        console2.log("Pyth contract    :", pythContract);

        vm.startBroadcast(deployerKey);

        TreasuryVaultTrustlessOracle impl = new TreasuryVaultTrustlessOracle();
        console2.log("Implementation   :", address(impl));

        VaultFactoryV2 factory = new VaultFactoryV2(
            address(impl),
            agentAddr,
            agentNFT,
            router,
            baseToken,
            riskToken,
            pythContract,
            pythPriceId,
            agentTokenId
        );
        console2.log("VaultFactoryV2   :", address(factory));

        if (createVaultStep) {
            address vault = factory.createVault(VaultFactoryV2.PresetTier.Balanced);
            console2.log("Canary vault     :", vault);
        } else {
            console2.log("createVault       : SKIPPED (run after owner setAuthorizedFactory)");
        }

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== NEXT (owner 0x981F, single tx): ===");
        console2.log("  setAuthorizedFactory(<factory above>, true)");
        console2.log("then [canary] createVault(Balanced) so authorizeUsageFromFactory fires.");
    }

    function _envBoolOr(string memory key, bool dflt) internal view returns (bool) {
        try vm.envBool(key) returns (bool v) { return v; } catch { return dflt; }
    }
}
