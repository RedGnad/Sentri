// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ExecutionRegistry} from "../src/ExecutionRegistry.sol";
import {PriceAttestedConsumer} from "../src/examples/PriceAttestedConsumer.sol";
import {FullStackAttestedConsumer} from "../src/examples/FullStackAttestedConsumer.sol";
import {PythPriceAdapter} from "../src/oracle/PythPriceAdapter.sol";
import {IPyth, PythStructs} from "../src/oracle/IPyth.sol";

contract MockPyth is IPyth {
    mapping(bytes32 => PythStructs.Price) private _prices;
    uint256 public updateFee = 1;

    function setPrice(bytes32 id, int64 price, uint64 conf, int32 expo, uint publishTime) external {
        _prices[id] = PythStructs.Price(price, conf, expo, publishTime);
    }

    function getUpdateFee(bytes[] calldata) external view returns (uint256) { return updateFee; }

    function updatePriceFeeds(bytes[] calldata) external payable {
        require(msg.value >= updateFee, "MockPyth: fee");
    }

    function getPriceNoOlderThan(bytes32 id, uint256) external view returns (PythStructs.Price memory) {
        return _prices[id];
    }
}

contract PriceAttestedConsumerTest is Test {
    ExecutionRegistry reg;
    MockPyth pyth;
    PriceAttestedConsumer consumer;

    uint256 signerPk = 0xA11CE;
    address signer;
    bytes32 priceId = keccak256("OG/USD");
    uint256 pubTime;
    bytes[] updateData;

    receive() external payable {}

    function setUp() public {
        reg = new ExecutionRegistry();
        pyth = new MockPyth();
        signer = vm.addr(signerPk);
        pubTime = block.timestamp;
        // 1.00 with expo -8 -> normalised to 8dp = 1e8; conf 1e6 -> 100 bps
        pyth.setPrice(priceId, int64(uint64(1e8)), uint64(1e6), int32(-8), pubTime);
        consumer = new PriceAttestedConsumer(reg, signer, 0, address(pyth), priceId, 60, 200);
        updateData.push(hex"00");
        vm.deal(address(this), 1 ether);
    }

    function _sign(string memory response) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(response));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_registeredOnConstruction() public view {
        assertTrue(reg.isRegistered(address(consumer)));
    }

    function test_happyPath_bindsPriceToReceipt() public {
        bytes memory sig = _sign("resp");
        uint256 balBefore = address(this).balance;

        (uint256 index, uint256 price) =
            consumer.executeWithVerifiedPrice{value: 1000}(keccak256("i1"), "resp", sig, updateData);

        assertEq(index, 0);
        assertEq(price, 1e8);
        assertEq(reg.receiptCount(address(consumer)), 1);

        ExecutionRegistry.Receipt memory rc = reg.receiptAt(address(consumer), 0);
        assertEq(rc.signer, signer);
        assertEq(rc.attestation, priceId);
        // payloadHash commits to the exact verified price tuple
        bytes32 expected = keccak256(abi.encode(uint256(1e8), pubTime, uint256(100)));
        assertEq(rc.payloadHash, expected);

        // only the 1-wei fee was spent; the rest refunded
        assertEq(address(this).balance, balBefore - 1);
    }

    function test_revertsOnConfidenceTooWide() public {
        // conf 5e6 on 1e8 price -> 500 bps > 200 max
        pyth.setPrice(priceId, int64(uint64(1e8)), uint64(5e6), int32(-8), block.timestamp);
        bytes memory sig = _sign("resp");
        vm.expectRevert(
            abi.encodeWithSelector(PythPriceAdapter.PythConfidenceTooWide.selector, uint256(500), uint256(200))
        );
        consumer.executeWithVerifiedPrice{value: 1000}(keccak256("i1"), "resp", sig, updateData);
    }

    function test_revertsOnFeeTooLow() public {
        bytes memory sig = _sign("resp");
        vm.expectRevert(abi.encodeWithSelector(PythPriceAdapter.PythFeeTooLow.selector, uint256(1), uint256(0)));
        consumer.executeWithVerifiedPrice{value: 0}(keccak256("i1"), "resp", sig, updateData);
    }

    function test_revertsOnEmptyUpdateData() public {
        bytes memory sig = _sign("resp");
        bytes[] memory empty = new bytes[](0);
        vm.expectRevert(PythPriceAdapter.PythUpdateDataEmpty.selector);
        consumer.executeWithVerifiedPrice{value: 1000}(keccak256("i1"), "resp", sig, empty);
    }

    function test_onlyOwner() public {
        bytes memory sig = _sign("resp");
        vm.prank(address(0xBAD));
        vm.expectRevert(PriceAttestedConsumer.NotOwner.selector);
        consumer.executeWithVerifiedPrice(keccak256("i1"), "resp", sig, updateData);
    }
}

contract FullStackAttestedConsumerTest is Test {
    ExecutionRegistry reg;
    MockPyth pyth;
    FullStackAttestedConsumer consumer;

    uint256 signerPk = 0xA11CE;
    address signer;
    bytes32 priceId = keccak256("OG/USD");
    uint256 pubTime;
    bytes[] updateData;
    bytes32 constant STORAGE_ROOT = keccak256("0g-storage-reasoning-root");

    receive() external payable {}

    function setUp() public {
        reg = new ExecutionRegistry();
        pyth = new MockPyth();
        signer = vm.addr(signerPk);
        pubTime = block.timestamp;
        pyth.setPrice(priceId, int64(uint64(1e8)), uint64(1e6), int32(-8), pubTime);
        consumer = new FullStackAttestedConsumer(reg, signer, 0, address(pyth), priceId, 60, 200);
        updateData.push(hex"00");
        vm.deal(address(this), 1 ether);
    }

    function _sign(string memory response) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(response));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_bindsStorageRootAndPrice() public {
        bytes memory sig = _sign("reasoning");
        (uint256 index, uint256 price) =
            consumer.executeFullStack{value: 1000}(keccak256("i1"), "reasoning", sig, updateData, STORAGE_ROOT);

        assertEq(index, 0);
        assertEq(price, 1e8);

        ExecutionRegistry.Receipt memory rc = reg.receiptAt(address(consumer), 0);
        assertEq(rc.signer, signer);
        // attestation anchors the 0G Storage reasoning root
        assertEq(rc.attestation, STORAGE_ROOT);
        // payload commits price tuple + feed id
        bytes32 expected = keccak256(abi.encode(uint256(1e8), pubTime, uint256(100), priceId));
        assertEq(rc.payloadHash, expected);
    }

    function test_onlyOwner() public {
        bytes memory sig = _sign("reasoning");
        vm.prank(address(0xBAD));
        vm.expectRevert(FullStackAttestedConsumer.NotOwner.selector);
        consumer.executeFullStack(keccak256("i1"), "reasoning", sig, updateData, STORAGE_ROOT);
    }
}
