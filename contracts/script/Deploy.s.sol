// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {SentriPair} from "../src/SentriPair.sol";
import {SentriSwapRouter} from "../src/SentriSwapRouter.sol";
import {SentriPriceFeed} from "../src/SentriPriceFeed.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// @notice Deploys the full Sentri stack on Galileo testnet:
///         tokens, oracle, AMM, agent identity, vault implementation, and
///         the public VaultFactory anyone can use to create their own vault.
///         Also creates one Balanced demo vault owned by the deployer.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");
        address teeSigner = vm.envAddress("TEE_SIGNER_ADDRESS");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // ── Tokens ───────────────────────────────────────────────────────
        MockUSDC usdc = new MockUSDC();
        MockWETH weth = new MockWETH();
        console2.log("MockUSDC:        ", address(usdc));
        console2.log("MockWETH:        ", address(weth));

        // ── Price feed ───────────────────────────────────────────────────
        SentriPriceFeed feed = new SentriPriceFeed(8, "WETH/USDC");
        feed.setKeeper(agent, true);
        feed.setKeeper(deployer, true);
        feed.pushAnswer(2000 * 1e8, keccak256("initial-deploy"));
        console2.log("SentriPriceFeed: ", address(feed));

        // ── AMM ──────────────────────────────────────────────────────────
        (address t0, address t1) = address(usdc) < address(weth)
            ? (address(usdc), address(weth))
            : (address(weth), address(usdc));
        SentriPair pair = new SentriPair(t0, t1);
        SentriSwapRouter router = new SentriSwapRouter(address(pair));
        console2.log("SentriPair:      ", address(pair));
        console2.log("SentriSwapRouter:", address(router));

        // Seed initial liquidity: 1,000,000 USDC + 500 WETH (1 WETH = 2000 USDC).
        usdc.mint(deployer, 1_000_000e6);
        weth.mint(deployer, 500e18);
        usdc.approve(address(router), type(uint256).max);
        weth.approve(address(router), type(uint256).max);
        (uint256 a0, uint256 a1) = t0 == address(usdc)
            ? (uint256(1_000_000e6), uint256(500e18))
            : (uint256(500e18), uint256(1_000_000e6));
        router.addLiquidity(a0, a1, deployer, block.timestamp + 3600);

        // ── Agent identity ───────────────────────────────────────────────
        AgentINFT agentNFT = new AgentINFT();
        console2.log("AgentINFT:       ", address(agentNFT));
        agentNFT.mint(
            agent,
            keccak256("sentri-enclave-v1"),
            keccak256("0g-sealed-inference-attestation"),
            "0G Sealed Inference",
            teeSigner
        );

        // ── Vault implementation (master, never used directly) ───────────
        TreasuryVault vaultImpl = new TreasuryVault();
        console2.log("TreasuryVault impl:", address(vaultImpl));

        // ── Vault factory (the public entry point) ───────────────────────
        VaultFactory factory = new VaultFactory(
            address(vaultImpl),
            agent,
            address(agentNFT),
            address(router),
            address(feed),
            address(usdc),
            address(weth)
        );
        console2.log("VaultFactory:    ", address(factory));

        // ── Demo vault owned by the deployer (Balanced preset) ───────────
        address demoVault = factory.createVault(VaultFactory.PresetTier.Balanced);
        console2.log("Demo vault:      ", demoVault);

        // Mint the deployer some USDC to seed the demo vault later if desired.
        usdc.mint(deployer, 100_000e6);

        vm.stopBroadcast();
    }
}
