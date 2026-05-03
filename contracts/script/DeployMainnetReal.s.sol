// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {JaineV3PoolAdapter} from "../src/JaineV3PoolAdapter.sol";
import {SentriPriceFeed} from "../src/SentriPriceFeed.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// @notice Deploys a 0G mainnet real-asset Sentri stack.
///         Base asset: USDC.E / bridged USDC
///         Risk asset: W0G
///         Venue: Jaine USDC.E/W0G V3-style pool, adapted to Sentri's router ABI
///
///         The script intentionally does not mint, seed mocks, or deposit user
///         funds. It creates a factory + empty demo vault for HackQuest mainnet
///         proof; any real deposit remains an explicit user action.
contract DeployMainnetReal is Script {
    // Verified from the public USDC.E/W0G Jaine pool on 0G mainnet.
    address internal constant DEFAULT_W0G = 0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c;
    address internal constant DEFAULT_USDCE = 0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E;
    address internal constant DEFAULT_JAINE_USDCE_W0G_POOL = 0xa9e824Eddb9677fB2189AB9c439238A83695C091;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");
        address teeSigner = vm.envAddress("TEE_SIGNER_ADDRESS");

        address base = vm.envOr("ZERO_G_MAINNET_USDCE_ADDRESS", DEFAULT_USDCE);
        address risk = vm.envOr("ZERO_G_MAINNET_W0G_ADDRESS", DEFAULT_W0G);
        address jainePool = vm.envOr("ZERO_G_MAINNET_JAINE_USDCE_W0G_POOL_ADDRESS", DEFAULT_JAINE_USDCE_W0G_POOL);

        vm.startBroadcast(deployerKey);

        JaineV3PoolAdapter adapter = new JaineV3PoolAdapter(jainePool);
        console2.log("JaineV3PoolAdapter:", address(adapter));
        console2.log("Base USDC.E:       ", base);
        console2.log("Risk W0G:          ", risk);
        console2.log("Jaine pool:        ", jainePool);

        SentriPriceFeed feed = new SentriPriceFeed(8, "W0G/USDC.E");
        feed.setKeeper(agent, true);
        feed.setKeeper(vm.addr(deployerKey), true);
        console2.log("SentriPriceFeed:   ", address(feed));

        AgentINFT agentNFT = new AgentINFT();
        agentNFT.mint(
            agent,
            keccak256("sentri-enclave-v1-mainnet"),
            keccak256("0g-sealed-inference-attestation-mainnet"),
            "0G Sealed Inference",
            teeSigner
        );
        console2.log("AgentINFT:         ", address(agentNFT));

        TreasuryVault vaultImpl = new TreasuryVault();
        console2.log("TreasuryVault impl:", address(vaultImpl));

        VaultFactory factory = new VaultFactory(
            address(vaultImpl),
            agent,
            address(agentNFT),
            address(adapter),
            address(feed),
            base,
            risk
        );
        console2.log("VaultFactory:      ", address(factory));

        address demoVault = factory.createVault(VaultFactory.PresetTier.Balanced);
        console2.log("Demo vault:        ", demoVault);

        vm.stopBroadcast();
    }
}
