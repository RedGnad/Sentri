// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";
import {AgentINFT} from "../src/AgentINFT.sol";
import {SentriPair} from "../src/SentriPair.sol";
import {SentriSwapRouter} from "../src/SentriSwapRouter.sol";
import {SentriPriceFeed} from "../src/SentriPriceFeed.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract TreasuryVaultTest is Test {
    MockUSDC usdc;
    MockWETH weth;
    AgentINFT agentNFT;
    SentriPair pair;
    SentriSwapRouter router;
    SentriPriceFeed feed;
    TreasuryVault vault;

    address owner = address(this);
    address agent = makeAddr("agent");
    uint256 teeSignerKey = 0xA11CE;
    address teeSigner;
    address alice = makeAddr("alice");
    address lper = makeAddr("lper");

    TreasuryVault.Policy defaultPolicy;

    // Oracle: 1 WETH = 2000 USDC, feed decimals = 8, so price raw = 2000 * 1e8
    int256 constant PRICE = 2000 * 1e8;

    function setUp() public {
        teeSigner = vm.addr(teeSignerKey);
        usdc = new MockUSDC();
        weth = new MockWETH();
        agentNFT = new AgentINFT();

        feed = new SentriPriceFeed(8, "WETH/USDC");
        feed.setKeeper(address(this), true);
        feed.pushAnswer(PRICE, keccak256("att-0"));

        // Pair ordered deterministically by address
        (address t0, address t1) = address(usdc) < address(weth)
            ? (address(usdc), address(weth))
            : (address(weth), address(usdc));
        pair = new SentriPair(t0, t1);
        router = new SentriSwapRouter(address(pair));

        // Seed LP: 1,000,000 USDC + 500 WETH → 1 WETH = 2000 USDC
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

        defaultPolicy = TreasuryVault.Policy({
            maxAllocationBps: 2000,        // 20%
            maxDrawdownBps: 1000,          // 10%
            rebalanceThresholdBps: 500,    // 5%
            maxSlippageBps: 300,           // 3%
            cooldownPeriod: 60,
            maxPriceStaleness: 600
        });

        // Deploy implementation, clone, initialize — same flow the factory uses.
        TreasuryVault impl = new TreasuryVault();
        vault = TreasuryVault(Clones.clone(address(impl)));
        vault.initialize(TreasuryVault.InitParams({
            owner: owner,
            base: address(usdc),
            risk: address(weth),
            agentNFT: address(agentNFT),
            router: address(router),
            priceFeed: address(feed),
            agent: agent,
            policy: defaultPolicy
        }));

        agentNFT.mint(agent, keccak256("enclave-v1"), keccak256("att-v1"), "0G Sealed Inference", teeSigner);

        usdc.mint(alice, 100_000e6);
    }

    // ── Init pattern ─────────────────────────────────────────────────────

    function test_implementation_disabled_initializers() public {
        TreasuryVault impl = new TreasuryVault();
        vm.expectRevert();
        impl.initialize(TreasuryVault.InitParams({
            owner: owner,
            base: address(usdc),
            risk: address(weth),
            agentNFT: address(agentNFT),
            router: address(router),
            priceFeed: address(feed),
            agent: agent,
            policy: defaultPolicy
        }));
    }

    function test_clone_cannot_be_double_initialized() public {
        vm.expectRevert();
        vault.initialize(TreasuryVault.InitParams({
            owner: owner,
            base: address(usdc),
            risk: address(weth),
            agentNFT: address(agentNFT),
            router: address(router),
            priceFeed: address(feed),
            agent: agent,
            policy: defaultPolicy
        }));
    }

    function test_initialize_reverts_zeroAddress() public {
        TreasuryVault impl = new TreasuryVault();
        TreasuryVault freshClone = TreasuryVault(Clones.clone(address(impl)));
        vm.expectRevert(TreasuryVault.ZeroAddress.selector);
        freshClone.initialize(TreasuryVault.InitParams({
            owner: address(0),
            base: address(usdc),
            risk: address(weth),
            agentNFT: address(agentNFT),
            router: address(router),
            priceFeed: address(feed),
            agent: agent,
            policy: defaultPolicy
        }));
    }

    // ── Deposit ──────────────────────────────────────────────────────────

    function test_deposit_updatesHighWaterMark() public {
        _depositAs(alice, 10_000e6);
        assertEq(vault.vaultBalance(), 10_000e6);
        assertEq(vault.highWaterMark(), 10_000e6);
    }

    function test_deposit_reverts_zero() public {
        vm.prank(alice);
        vm.expectRevert(TreasuryVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_deposit_reverts_whenKilled() public {
        vault.emergencyWithdraw();
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000e6);
        vm.expectRevert(TreasuryVault.VaultKilled.selector);
        vault.deposit(1_000e6);
        vm.stopPrank();
    }

    function test_depositFrom_byFactory_creditsCorrectly() public {
        address proxy = address(this);
        usdc.mint(proxy, 5_000e6);
        usdc.approve(address(vault), 5_000e6);
        vault.depositFrom(proxy, 5_000e6);
        assertEq(vault.vaultBalance(), 5_000e6);
        assertEq(vault.highWaterMark(), 5_000e6);
    }

    function test_depositFrom_reverts_nonFactory() public {
        address proxy = makeAddr("proxy");
        vm.prank(proxy);
        vm.expectRevert(TreasuryVault.NotFactory.selector);
        vault.depositFrom(proxy, 5_000e6);
    }

    function test_depositFrom_reverts_zeroPayer() public {
        vm.expectRevert(TreasuryVault.ZeroAddress.selector);
        vault.depositFrom(address(0), 100);
    }

    function test_withdraw_scalesHWMProportionally() public {
        _depositAs(alice, 10_000e6);
        // Strategy gain: simulate by directly transferring more USDC to vault
        // (no oracle move involved, so TVL tracks balance).
        usdc.mint(address(this), 1_000e6);
        usdc.transfer(address(vault), 1_000e6);
        // Trigger HWM bump: another deposit (smallest possible) updates HWM
        usdc.mint(alice, 1);
        vm.startPrank(alice);
        usdc.approve(address(vault), 1);
        vault.deposit(1);
        vm.stopPrank();
        uint256 hwmBefore = vault.highWaterMark();
        assertEq(hwmBefore, 11_000e6 + 1);

        // Now withdraw half — HWM must scale to half
        uint256 tvlBefore = vault.totalValue();
        vault.withdraw(owner, 5_500e6);
        uint256 tvlAfter = vault.totalValue();
        uint256 expectedHWM = (hwmBefore * tvlAfter) / tvlBefore;
        assertEq(vault.highWaterMark(), expectedHWM);
    }

    // ── Execute: base → risk (Rebalance) ─────────────────────────────────

    function test_executeStrategy_swapsBaseToRisk() public {
        _depositAs(alice, 10_000e6);

        uint256 usdcBefore = vault.vaultBalance();
        uint256 wethBefore = vault.riskBalance();

        vm.prank(agent);
        _execute(vault, TreasuryVault.Action.Rebalance, 1_000e6, "p");

        assertEq(vault.vaultBalance(), usdcBefore - 1_000e6);
        assertGt(vault.riskBalance(), wethBefore);
        assertEq(vault.executionLogCount(), 1);
    }

    function test_executeStrategy_reverts_allocationExceeded() public {
        _depositAs(alice, 10_000e6);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.AllocationExceeded.selector);
        _execute(vault, TreasuryVault.Action.Rebalance, 3_000e6, "p");
    }

    function test_executeStrategy_reverts_cooldown() public {
        _depositAs(alice, 10_000e6);
        vm.prank(agent);
        _execute(vault, TreasuryVault.Action.Rebalance, 500e6, "p1");
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.CooldownNotElapsed.selector);
        _execute(vault, TreasuryVault.Action.Rebalance, 500e6, "p2");
    }

    function test_executeStrategy_succeeds_afterCooldown() public {
        _depositAs(alice, 10_000e6);
        vm.prank(agent);
        _execute(vault, TreasuryVault.Action.Rebalance, 500e6, "p1");
        vm.warp(block.timestamp + 61);
        vm.prank(agent);
        _execute(vault, TreasuryVault.Action.YieldFarm, 500e6, "p2");
        assertEq(vault.executionLogCount(), 2);
    }

    function test_executeStrategy_reverts_invalidTEESignature() public {
        _depositAs(alice, 10_000e6);
        bytes memory badSig = _signature(0xB0B, _response("bad"));
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.InvalidTEESignature.selector);
        vault.executeStrategy(
            TreasuryVault.Action.Rebalance,
            500e6,
            keccak256("intent"),
            _response("bad"),
            badSig,
            keccak256("att"),
            block.timestamp + 300
        );
    }

    function test_executeStrategy_reverts_reusedIntentHash() public {
        _depositAs(alice, 10_000e6);
        bytes32 intentHash = keccak256("same-intent");
        vm.prank(agent);
        _executeWithIntent(vault, TreasuryVault.Action.Rebalance, 500e6, "p1", intentHash, block.timestamp + 300);

        vm.warp(block.timestamp + 61);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.IntentAlreadyUsed.selector);
        _executeWithIntent(vault, TreasuryVault.Action.YieldFarm, 500e6, "p2", intentHash, block.timestamp + 300);
    }

    function test_executeStrategy_reverts_reusedResponseHash() public {
        _depositAs(alice, 10_000e6);
        vm.prank(agent);
        _execute(vault, TreasuryVault.Action.Rebalance, 500e6, "same-response");

        vm.warp(block.timestamp + 61);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.ResponseAlreadyUsed.selector);
        _executeWithIntent(
            vault,
            TreasuryVault.Action.YieldFarm,
            500e6,
            "same-response",
            keccak256("fresh-intent-same-response"),
            block.timestamp + 300
        );
    }

    function test_executeStrategy_reverts_expiredIntent() public {
        _depositAs(alice, 10_000e6);
        vm.warp(block.timestamp + 301);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.ExpiredIntent.selector);
        _executeWithIntent(vault, TreasuryVault.Action.Rebalance, 500e6, "expired", keccak256("expired"), block.timestamp - 1);
    }

    // ── Execute: risk → base (Deleverage) ────────────────────────────────

    function test_executeStrategy_deleverage() public {
        _depositAs(alice, 10_000e6);
        // Open a position first
        vm.prank(agent);
        _execute(vault, TreasuryVault.Action.Rebalance, 1_000e6, "p");

        vm.warp(block.timestamp + 61);

        uint256 wethBal = vault.riskBalance();
        assertGt(wethBal, 0);

        vm.prank(agent);
        _execute(vault, TreasuryVault.Action.EmergencyDeleverage, wethBal / 2, "p2");
        assertLt(vault.riskBalance(), wethBal);
    }

    function test_deleverage_notBlocked_whenExposureAboveCap() public {
        _depositAs(alice, 10_000e6);
        weth.mint(address(vault), 2e18); // 4,000 USDC of risk value, above 20% cap.
        uint256 wethBal = vault.riskBalance();

        vm.prank(agent);
        _execute(vault, TreasuryVault.Action.EmergencyDeleverage, wethBal / 2, "deleverage");

        assertLt(vault.riskBalance(), wethBal);
    }

    // ── Oracle / slippage ────────────────────────────────────────────────

    function test_executeStrategy_reverts_priceStale() public {
        _depositAs(alice, 10_000e6);
        vm.warp(block.timestamp + 7200); // staleness = 600
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.PriceStale.selector);
        _execute(vault, TreasuryVault.Action.Rebalance, 500e6, "p");
    }

    function test_executeStrategy_reverts_slippage_whenOracleTooFar() public {
        _depositAs(alice, 10_000e6);
        // Move oracle to pretend 1 WETH = 100 USDC (way off from pool's 2000).
        // Pool will give ~0.5 WETH for 1000 USDC, but oracle expects ~10 WETH,
        // so minOut > actualOut → router reverts on slippage.
        feed.pushAnswer(100 * 1e8, keccak256("att-drift"));
        vm.prank(agent);
        vm.expectRevert(SentriSwapRouter.InsufficientAmountOut.selector);
        _execute(vault, TreasuryVault.Action.Rebalance, 1_000e6, "p");
    }

    // ── Kill-switch ──────────────────────────────────────────────────────

    function test_emergencyWithdraw_drainsBoth() public {
        _depositAs(alice, 10_000e6);
        vm.prank(agent);
        _execute(vault, TreasuryVault.Action.Rebalance, 1_000e6, "p");

        uint256 usdcBefore = usdc.balanceOf(owner);
        uint256 wethBefore = weth.balanceOf(owner);
        vault.emergencyWithdraw();
        assertEq(vault.killed(), true);
        assertEq(vault.vaultBalance(), 0);
        assertEq(vault.riskBalance(), 0);
        assertGt(usdc.balanceOf(owner), usdcBefore);
        assertGt(weth.balanceOf(owner), wethBefore);
    }

    function test_emergencyDeleverageAndWithdraw_returnsBaseOnly() public {
        _depositAs(alice, 10_000e6);
        vm.prank(agent);
        _execute(vault, TreasuryVault.Action.Rebalance, 1_000e6, "p");

        uint256 usdcBefore = usdc.balanceOf(owner);
        vault.emergencyDeleverageAndWithdraw(0);

        assertEq(vault.killed(), true);
        assertEq(vault.vaultBalance(), 0);
        assertEq(vault.riskBalance(), 0);
        assertGt(usdc.balanceOf(owner), usdcBefore);
    }

    // ── Admin ────────────────────────────────────────────────────────────

    function test_setPolicy() public {
        TreasuryVault.Policy memory p = TreasuryVault.Policy({
            maxAllocationBps: 3000,
            maxDrawdownBps: 1500,
            rebalanceThresholdBps: 300,
            maxSlippageBps: 200,
            cooldownPeriod: 120,
            maxPriceStaleness: 600
        });
        vault.setPolicy(p);
        (uint16 alloc,,,,, ) = vault.policy();
        assertEq(alloc, 3000);
    }

    function test_setPolicy_reverts_invalid() public {
        TreasuryVault.Policy memory bad = TreasuryVault.Policy({
            maxAllocationBps: 0,
            maxDrawdownBps: 1000,
            rebalanceThresholdBps: 500,
            maxSlippageBps: 300,
            cooldownPeriod: 60,
            maxPriceStaleness: 3600
        });
        vm.expectRevert(TreasuryVault.InvalidPolicy.selector);
        vault.setPolicy(bad);
    }

    // ── AgentINFT gating ─────────────────────────────────────────────────

    function test_revokedAgent_cannotExecute() public {
        _depositAs(alice, 10_000e6);
        agentNFT.revoke(0);
        vm.prank(agent);
        vm.expectRevert(TreasuryVault.AgentNotVerified.selector);
        _execute(vault, TreasuryVault.Action.Rebalance, 500e6, "p");
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    function _depositAs(address user, uint256 amount) internal {
        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }

    function _execute(TreasuryVault target, TreasuryVault.Action action, uint256 amount, string memory tag) internal {
        _executeWithIntent(
            target,
            action,
            amount,
            tag,
            keccak256(abi.encodePacked("intent:", tag)),
            block.timestamp + 300
        );
    }

    function _executeWithIntent(
        TreasuryVault target,
        TreasuryVault.Action action,
        uint256 amount,
        string memory tag,
        bytes32 intentHash,
        uint256 deadline
    ) internal {
        string memory response = _response(tag);
        target.executeStrategy(
            action,
            amount,
            intentHash,
            response,
            _signature(teeSignerKey, response),
            keccak256(abi.encodePacked("att:", tag)),
            deadline
        );
    }

    function _response(string memory tag) internal pure returns (string memory) {
        return string.concat('{"action":"Rebalance","amount_bps":1000,"rule_id":"', tag, '","confidence":90,"short_reason":"test"}');
    }

    function _signature(uint256 key, string memory response) internal returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(response));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
