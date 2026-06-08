// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EntryPoint} from "@account-abstraction/contracts/core/EntryPoint.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {VerifyingPaymaster} from "@account-abstraction/contracts/samples/VerifyingPaymaster.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Coverage for the gas-sponsorship paymaster used by Sentri's Safe
///         smart wallets on 0G. The paymaster itself is the unmodified audited
///         eth-infinitism VerifyingPaymaster; these tests lock the wiring and,
///         critically, the off-chain/on-chain hash agreement that the Sentri
///         paymaster signer service relies on to sign sponsorships.
contract PaymasterTest is Test {
    EntryPoint internal ep;
    VerifyingPaymaster internal paymaster;

    uint256 internal signerKey = 0xA11CE;
    address internal signer;

    function setUp() public {
        ep = new EntryPoint();
        signer = vm.addr(signerKey);
        paymaster = new VerifyingPaymaster(IEntryPoint(address(ep)), signer);
    }

    function _userOp() internal view returns (PackedUserOperation memory op) {
        // paymasterAndData must be >= 52 bytes: addr(20) + validationGas(16) +
        // postOpGas(16) so getHash can slice the gas window [20:52].
        bytes memory pnd = abi.encodePacked(address(paymaster), uint128(50_000), uint128(50_000));
        op = PackedUserOperation({
            sender: address(0xBEEF),
            nonce: 7,
            initCode: "",
            callData: hex"deadbeef",
            accountGasLimits: bytes32(uint256(100_000) << 128 | uint256(100_000)),
            preVerificationGas: 21_000,
            gasFees: bytes32(uint256(1 gwei) << 128 | uint256(1 gwei)),
            paymasterAndData: pnd,
            signature: ""
        });
    }

    function test_wiring() public view {
        assertEq(paymaster.owner(), address(this));
        assertEq(paymaster.verifyingSigner(), signer);
        assertEq(address(paymaster.entryPoint()), address(ep));
    }

    /// The signer service computes getHash off-chain, signs the eth-signed-message
    /// form, and the paymaster recovers it on-chain. This proves both sides agree.
    function test_getHash_offchain_onchain_agreement() public view {
        PackedUserOperation memory op = _userOp();
        uint48 validUntil = uint48(block.timestamp + 3600);
        uint48 validAfter = uint48(block.timestamp);

        bytes32 hash = paymaster.getHash(op, validUntil, validAfter);
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, ethHash);
        address recovered = ECDSA.recover(ethHash, abi.encodePacked(r, s, v));

        assertEq(recovered, signer, "signer service signature must recover to verifyingSigner");
    }

    /// A different validity window must produce a different hash (signatures are
    /// bound to the window the service approved).
    function test_getHash_changes_with_validity_window() public view {
        PackedUserOperation memory op = _userOp();
        bytes32 a = paymaster.getHash(op, uint48(1000), uint48(0));
        bytes32 b = paymaster.getHash(op, uint48(2000), uint48(0));
        assertTrue(a != b, "hash must depend on validUntil");
    }

    /// A signature from a key other than verifyingSigner must NOT recover to it.
    function test_wrongSigner_doesNotRecover() public view {
        PackedUserOperation memory op = _userOp();
        bytes32 hash = paymaster.getHash(op, uint48(block.timestamp + 3600), uint48(block.timestamp));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADBAD, ethHash);
        address recovered = ECDSA.recover(ethHash, abi.encodePacked(r, s, v));
        assertTrue(recovered != signer, "a non-signer key must not recover to verifyingSigner");
    }
}
