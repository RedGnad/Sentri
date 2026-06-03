// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TreasuryVaultTrustlessOracle} from "../src/TreasuryVaultTrustlessOracle.sol";
import {VaultFactoryV2} from "../src/VaultFactoryV2.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockWETH} from "../src/MockWETH.sol";

/// @notice Deploy TrustlessOracleVault infrastructure on 0G testnet.
///
/// Prerequisites (env vars):
///   PRIVATE_KEY               — deployer key
///   AGENT_ADDRESS             — agent wallet address
///   AGENT_NFT_ADDRESS         — deployed AgentINFT
///   ROUTER_ADDRESS            — SentriSwapRouter
///   BASE_TOKEN_ADDRESS        — MockUSDC
///   RISK_TOKEN_ADDRESS        — MockWETH
///   AGENT_TOKEN_ID            — agent's INFT token id
///   PYTH_CONTRACT_ADDRESS     — Pyth EVM contract on 0G (see smoke test)
///   PYTH_PRICE_ID             — bytes32 feed id (ETH/USD or W0G/USD)
///   TEE_SIGNER_ADDRESS        — TEE signer wallet (for demo vault init)
///
/// Usage:
///   forge script script/DeployTrustlessOracle.s.sol \
///     --rpc-url https://evmrpc-testnet.0g.ai \
///     --broadcast --verify
contract DeployTrustlessOracle is Script {
    function run() external {
        uint256 deployerKey = uint256(vm.envBytes32("PRIVATE_KEY"));
        address deployer    = vm.addr(deployerKey);

        address agentAddr   = vm.envAddress("AGENT_ADDRESS");
        address agentNFT    = vm.envAddress("AGENT_NFT_ADDRESS");
        address router      = vm.envAddress("ROUTER_ADDRESS");
        address baseToken   = vm.envAddress("BASE_TOKEN_ADDRESS");
        address riskToken   = vm.envAddress("RISK_TOKEN_ADDRESS");
        uint256 agentTokenId = vm.envUint("AGENT_TOKEN_ID");
        address pythContract = vm.envAddress("PYTH_CONTRACT_ADDRESS");
        bytes32 pythPriceId  = vm.envBytes32("PYTH_PRICE_ID");

        console2.log("=== Sentri Trustless Oracle Vault Deployment ===");
        console2.log("Deployer        :", deployer);
        console2.log("Agent           :", agentAddr);
        console2.log("Pyth contract   :", pythContract);
        console2.log("Pyth price id   :");
        console2.logBytes32(pythPriceId);

        vm.startBroadcast(deployerKey);

        // 1. Deploy TrustlessOracle implementation (master clone target).
        TreasuryVaultTrustlessOracle impl = new TreasuryVaultTrustlessOracle();
        console2.log("Implementation  :", address(impl));

        // 2. Deploy VaultFactoryV2.
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
        console2.log("VaultFactoryV2  :", address(factory));

        // 3. Authorize VaultFactoryV2 in AgentINFT so new vaults are immediately usable.
        AgentINFT(agentNFT).setAuthorizedFactory(address(factory), true);
        console2.log("Factory authorized in AgentINFT");

        // 4. Create one demo vault (Balanced preset).
        address demoVault = factory.createVault(VaultFactoryV2.PresetTier.Balanced);
        console2.log("Demo vault      :", demoVault);

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Next steps ===");
        console2.log("1. Run scripts/pyth-smoke.ts to verify Pyth works on 0G");
        console2.log("2. Fund the demo vault with MockUSDC");
        console2.log("3. Set VAULT_TRUSTLESS_ADDRESS=", demoVault);
        console2.log("4. Set ORACLE_MODE=trustless-pyth in agent env");
        console2.log("5. Execute 3 successful and 2 rejection canary txs");
    }
}
