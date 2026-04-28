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

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");
        address deployer = vm.addr(deployerKey);

        TreasuryVault.Policy memory policy = TreasuryVault.Policy({
            maxAllocationBps: 2000,        // 20%
            maxDrawdownBps: 1000,          // 10%
            rebalanceThresholdBps: 500,    // 5%
            maxSlippageBps: 300,           // 3%
            cooldownPeriod: 300,           // 5 minutes
            maxPriceStaleness: 3600        // 1 hour
        });

        vm.startBroadcast(deployerKey);

        // ── Tokens ───────────────────────────────────────────────────────
        MockUSDC usdc = new MockUSDC();
        MockWETH weth = new MockWETH();
        console2.log("MockUSDC:", address(usdc));
        console2.log("MockWETH:", address(weth));

        // ── Price feed ───────────────────────────────────────────────────
        SentriPriceFeed feed = new SentriPriceFeed(8, "WETH/USDC");
        feed.setKeeper(agent, true);
        feed.setKeeper(deployer, true);
        feed.pushAnswer(2000 * 1e8, keccak256("initial-deploy"));
        console2.log("SentriPriceFeed:", address(feed));

        // ── AMM ──────────────────────────────────────────────────────────
        (address t0, address t1) = address(usdc) < address(weth)
            ? (address(usdc), address(weth))
            : (address(weth), address(usdc));
        SentriPair pair = new SentriPair(t0, t1);
        SentriSwapRouter router = new SentriSwapRouter(address(pair));
        console2.log("SentriPair:", address(pair));
        console2.log("SentriSwapRouter:", address(router));

        // Seed initial liquidity: 1,000,000 USDC + 500 WETH  (1 WETH = 2000 USDC)
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
        console2.log("AgentINFT:", address(agentNFT));
        agentNFT.mint(
            agent,
            keccak256("sentri-enclave-v1"),
            keccak256("0g-sealed-inference-attestation"),
            "0G Sealed Inference"
        );

        // ── Vault ────────────────────────────────────────────────────────
        TreasuryVault vault = new TreasuryVault(
            address(usdc),
            address(weth),
            address(agentNFT),
            address(router),
            address(feed),
            agent,
            policy
        );
        console2.log("TreasuryVault:", address(vault));

        // Deployer dust for testing
        usdc.mint(deployer, 100_000e6);

        vm.stopBroadcast();
    }
}
