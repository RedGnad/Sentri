// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {SentriPair} from "../src/SentriPair.sol";
import {SentriSwapRouter} from "../src/SentriSwapRouter.sol";
import {SentriPriceFeed} from "../src/SentriPriceFeed.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

contract VaultFactoryTest is Test {
    MockUSDC usdc;
    MockWETH weth;
    AgentINFT agentNFT;
    SentriPair pair;
    SentriSwapRouter router;
    SentriPriceFeed feed;
    TreasuryVault impl;
    VaultFactory factory;

    address agent = makeAddr("agent");
    address teeSigner = makeAddr("teeSigner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address lper = makeAddr("lper");

    int256 constant PRICE = 2000 * 1e8;

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockWETH();
        agentNFT = new AgentINFT();

        feed = new SentriPriceFeed(8, "WETH/USDC");
        feed.setKeeper(address(this), true);
        feed.pushAnswer(PRICE, keccak256("att-0"));

        (address t0, address t1) = address(usdc) < address(weth)
            ? (address(usdc), address(weth))
            : (address(weth), address(usdc));
        pair = new SentriPair(t0, t1);
        router = new SentriSwapRouter(address(pair));

        usdc.mint(lper, 1_000_000e6);
        weth.mint(lper, 500e18);
        vm.startPrank(lper);
        usdc.approve(address(router), type(uint256).max);
        weth.approve(address(router), type(uint256).max);
        (uint256 a0, uint256 a1) = t0 == address(usdc)
            ? (uint256(1_000_000e6), uint256(500e18))
            : (uint256(500e18), uint256(1_000_000e6));
        router.addLiquidity(a0, a1, lper, block.timestamp + 1);
        vm.stopPrank();

        agentNFT.mint(agent, keccak256("enclave"), keccak256("att"), "0G Sealed Inference", teeSigner);

        impl = new TreasuryVault();
        factory = new VaultFactory(
            address(impl),
            agent,
            address(agentNFT),
            address(router),
            address(feed),
            address(usdc),
            address(weth)
        );
    }

    // ── Constructor / immutables ─────────────────────────────────────────

    function test_constructor_storesImmutables() public view {
        assertEq(factory.implementation(), address(impl));
        assertEq(factory.agent(), agent);
        assertEq(factory.agentNFT(), address(agentNFT));
        assertEq(factory.router(), address(router));
        assertEq(factory.priceFeed(), address(feed));
        assertEq(factory.base(), address(usdc));
        assertEq(factory.risk(), address(weth));
    }

    function test_constructor_revertsZeroAddress() public {
        vm.expectRevert(VaultFactory.ZeroAddress.selector);
        new VaultFactory(address(0), agent, address(agentNFT), address(router), address(feed), address(usdc), address(weth));
    }

    // ── Preset creation ──────────────────────────────────────────────────

    function test_createVault_conservative_setsCorrectPolicy() public {
        vm.prank(alice);
        address vault = factory.createVault(VaultFactory.PresetTier.Conservative);
        TreasuryVault v = TreasuryVault(vault);
        (uint16 alloc, uint16 dd, uint16 reb, uint16 slp, uint32 cd, uint32 stale) = v.policy();
        assertEq(alloc, 1500);
        assertEq(dd, 200);
        assertEq(reb, 200);
        assertEq(slp, 50);
        assertEq(cd, 600);
        assertEq(stale, 120);
        assertEq(v.owner(), alice);
        assertEq(address(v.base()), address(usdc));
        assertEq(address(v.risk()), address(weth));
        assertEq(v.agent(), agent);
    }

    function test_createVault_balanced_setsCorrectPolicy() public {
        vm.prank(alice);
        address vault = factory.createVault(VaultFactory.PresetTier.Balanced);
        TreasuryVault v = TreasuryVault(vault);
        (uint16 alloc, uint16 dd, , uint16 slp, uint32 cd,) = v.policy();
        assertEq(alloc, 3000);
        assertEq(dd, 500);
        assertEq(slp, 100);
        assertEq(cd, 300);
    }

    function test_createVault_aggressive_setsCorrectPolicy() public {
        vm.prank(alice);
        address vault = factory.createVault(VaultFactory.PresetTier.Aggressive);
        TreasuryVault v = TreasuryVault(vault);
        (uint16 alloc, uint16 dd, , uint16 slp, uint32 cd,) = v.policy();
        assertEq(alloc, 5000);
        assertEq(dd, 1000);
        assertEq(slp, 200);
        assertEq(cd, 180);
    }

    function test_createVault_revertsOnCustomTier() public {
        vm.prank(alice);
        vm.expectRevert(VaultFactory.InvalidPreset.selector);
        factory.createVault(VaultFactory.PresetTier.Custom);
    }

    // ── Custom policy ────────────────────────────────────────────────────

    function _validCustom() internal pure returns (TreasuryVault.Policy memory) {
        return TreasuryVault.Policy({
            maxAllocationBps: 2500,
            maxDrawdownBps: 800,
            rebalanceThresholdBps: 400,
            maxSlippageBps: 150,
            cooldownPeriod: 240,
            maxPriceStaleness: 90
        });
    }

    function test_createVaultWithCustomPolicy_works() public {
        TreasuryVault.Policy memory pol = _validCustom();
        vm.prank(alice);
        address vault = factory.createVaultWithCustomPolicy(pol);
        TreasuryVault v = TreasuryVault(vault);
        (uint16 alloc,,,,, ) = v.policy();
        assertEq(alloc, 2500);
        assertEq(v.owner(), alice);
    }

    function test_customPolicy_revertsAllocTooHigh() public {
        TreasuryVault.Policy memory pol = _validCustom();
        pol.maxAllocationBps = 6000; // > 5000 cap
        vm.expectRevert(VaultFactory.CustomPolicyOutOfRange.selector);
        factory.createVaultWithCustomPolicy(pol);
    }

    function test_customPolicy_revertsDrawdownTooHigh() public {
        TreasuryVault.Policy memory pol = _validCustom();
        pol.maxDrawdownBps = 2500; // > 2000 cap
        vm.expectRevert(VaultFactory.CustomPolicyOutOfRange.selector);
        factory.createVaultWithCustomPolicy(pol);
    }

    function test_customPolicy_revertsSlippageTooHigh() public {
        TreasuryVault.Policy memory pol = _validCustom();
        pol.maxSlippageBps = 600; // > 500 cap
        vm.expectRevert(VaultFactory.CustomPolicyOutOfRange.selector);
        factory.createVaultWithCustomPolicy(pol);
    }

    function test_customPolicy_revertsCooldownTooShort() public {
        TreasuryVault.Policy memory pol = _validCustom();
        pol.cooldownPeriod = 30; // < 60s min
        vm.expectRevert(VaultFactory.CustomPolicyOutOfRange.selector);
        factory.createVaultWithCustomPolicy(pol);
    }

    function test_customPolicy_revertsZeroValues() public {
        TreasuryVault.Policy memory pol = _validCustom();
        pol.maxAllocationBps = 0;
        vm.expectRevert(VaultFactory.CustomPolicyOutOfRange.selector);
        factory.createVaultWithCustomPolicy(pol);
    }

    // ── Atomic create + deposit ──────────────────────────────────────────

    function test_createVaultAndDeposit_atomic() public {
        usdc.mint(alice, 5_000e6);
        vm.startPrank(alice);
        usdc.approve(address(factory), 5_000e6);
        address vault = factory.createVaultAndDeposit(VaultFactory.PresetTier.Balanced, 5_000e6);
        vm.stopPrank();

        TreasuryVault v = TreasuryVault(vault);
        assertEq(v.vaultBalance(), 5_000e6);
        assertEq(v.highWaterMark(), 5_000e6);
        assertEq(v.owner(), alice);
    }

    function test_createVaultWithCustomPolicyAndDeposit_atomic() public {
        TreasuryVault.Policy memory pol = _validCustom();
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(factory), 1_000e6);
        address vault = factory.createVaultWithCustomPolicyAndDeposit(pol, 1_000e6);
        vm.stopPrank();

        TreasuryVault v = TreasuryVault(vault);
        assertEq(v.vaultBalance(), 1_000e6);
    }

    function test_createVaultAndDeposit_zeroAmount_skipsDeposit() public {
        vm.prank(alice);
        address vault = factory.createVaultAndDeposit(VaultFactory.PresetTier.Balanced, 0);
        TreasuryVault v = TreasuryVault(vault);
        assertEq(v.vaultBalance(), 0);
        assertEq(v.owner(), alice);
    }

    // ── Registry ─────────────────────────────────────────────────────────

    function test_registry_tracksAllVaults() public {
        vm.prank(alice);
        address v1 = factory.createVault(VaultFactory.PresetTier.Balanced);
        vm.prank(bob);
        address v2 = factory.createVault(VaultFactory.PresetTier.Conservative);
        vm.prank(alice);
        address v3 = factory.createVault(VaultFactory.PresetTier.Aggressive);

        assertEq(factory.vaultsCount(), 3);
        assertEq(factory.allVaults(0), v1);
        assertEq(factory.allVaults(1), v2);
        assertEq(factory.allVaults(2), v3);
    }

    function test_registry_isolatesByOwner() public {
        vm.prank(alice);
        address v1 = factory.createVault(VaultFactory.PresetTier.Balanced);
        vm.prank(bob);
        address v2 = factory.createVault(VaultFactory.PresetTier.Conservative);
        vm.prank(alice);
        address v3 = factory.createVault(VaultFactory.PresetTier.Aggressive);

        address[] memory aliceVaults = factory.vaultsByOwner(alice);
        address[] memory bobVaults = factory.vaultsByOwner(bob);
        assertEq(aliceVaults.length, 2);
        assertEq(bobVaults.length, 1);
        assertEq(aliceVaults[0], v1);
        assertEq(aliceVaults[1], v3);
        assertEq(bobVaults[0], v2);

        assertEq(factory.vaultsByOwnerCount(alice), 2);
        assertEq(factory.vaultsByOwnerCount(bob), 1);
    }

    function test_vaultsPage_pagination() public {
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(alice);
            factory.createVault(VaultFactory.PresetTier.Balanced);
        }
        address[] memory page1 = factory.vaultsPage(0, 4);
        assertEq(page1.length, 4);
        address[] memory page2 = factory.vaultsPage(4, 4);
        assertEq(page2.length, 4);
        address[] memory page3 = factory.vaultsPage(8, 4);
        assertEq(page3.length, 2);
        address[] memory empty = factory.vaultsPage(20, 4);
        assertEq(empty.length, 0);
    }

    // ── Preset preview ───────────────────────────────────────────────────

    function test_previewPresetPolicy_returnsExpected() public view {
        TreasuryVault.Policy memory bal = factory.previewPresetPolicy(VaultFactory.PresetTier.Balanced);
        assertEq(bal.maxAllocationBps, 3000);
        assertEq(bal.maxSlippageBps, 100);
    }

    function test_previewPresetPolicy_revertsOnCustom() public {
        vm.expectRevert(VaultFactory.InvalidPreset.selector);
        factory.previewPresetPolicy(VaultFactory.PresetTier.Custom);
    }

    // ── Cross-vault isolation ────────────────────────────────────────────

    function test_eachVaultIsIsolated_ownerCannotTouchOthers() public {
        vm.prank(alice);
        address v1 = factory.createVault(VaultFactory.PresetTier.Balanced);
        vm.prank(bob);
        address v2 = factory.createVault(VaultFactory.PresetTier.Balanced);

        TreasuryVault va = TreasuryVault(v1);
        TreasuryVault vb = TreasuryVault(v2);

        // Alice cannot pause Bob's vault
        vm.prank(alice);
        vm.expectRevert();
        vb.pause();

        // Bob cannot withdraw from Alice's vault
        vm.prank(bob);
        vm.expectRevert();
        va.withdraw(bob, 1);
    }
}
