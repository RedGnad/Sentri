// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ExecutionRegistry, ISignerVerifier} from "../src/ExecutionRegistry.sol";
import {AgentINFTSignerVerifier, IAgentSignerSource} from "../src/AgentINFTSignerVerifier.sol";
import {ExampleRegistryConsumer} from "../src/examples/ExampleRegistryConsumer.sol";

// ── Mocks ────────────────────────────────────────────────────────────────────

contract MockVerifier is ISignerVerifier {
    bool public ok = true;
    function set(bool v) external { ok = v; }
    function isValidSigner(address, address) external view returns (bool) { return ok; }
}

contract MockAgentSource is IAgentSignerSource {
    mapping(address => mapping(address => bool)) public bound;
    function bind(address agent, address signer, bool v) external { bound[agent][signer] = v; }
    function isActiveAgentWithSigner(address agent, address signer) external view returns (bool) {
        return bound[agent][signer];
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

contract ExecutionRegistryTest is Test {
    ExecutionRegistry reg;

    uint256 signerPk = 0xA11CE;
    address signer;
    address consumer = address(0xC0FFEE);
    address attacker = address(0xBAD);

    // mirror of ExecutionRegistry.ExecutionRecorded for expectEmit
    event ExecutionRecorded(
        address indexed consumer,
        uint256 indexed index,
        address indexed signer,
        bytes32 intentHash,
        bytes32 responseHash,
        bytes32 attestation,
        bytes32 payloadHash,
        uint64 timestamp,
        string signedResponse,
        bytes signature
    );

    function setUp() public {
        reg = new ExecutionRegistry();
        signer = vm.addr(signerPk);
    }

    // helpers ----------------------------------------------------------------

    function _sign(uint256 pk, string memory response) internal pure returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(response));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _record(address who, bytes32 intent, string memory response, uint256 pk)
        internal
        returns (uint256)
    {
        bytes memory sig = _sign(pk, response);
        vm.prank(who);
        return reg.recordExecution(intent, response, sig, bytes32(uint256(0xAB)), hex"1234");
    }

    // registration -----------------------------------------------------------

    function test_register_and_isRegistered() public {
        vm.prank(consumer);
        reg.register(signer, address(0), 0);
        assertTrue(reg.isRegistered(consumer));
    }

    function test_register_revertsOnDouble() public {
        vm.startPrank(consumer);
        reg.register(signer, address(0), 0);
        vm.expectRevert(ExecutionRegistry.AlreadyRegistered.selector);
        reg.register(signer, address(0), 0);
        vm.stopPrank();
    }

    function test_register_revertsWithoutAuthoriser() public {
        vm.prank(consumer);
        vm.expectRevert(ExecutionRegistry.NoAuthoriserConfigured.selector);
        reg.register(address(0), address(0), 0);
    }

    function test_updateConfig_revertsIfNotRegistered() public {
        vm.prank(consumer);
        vm.expectRevert(ExecutionRegistry.NotRegistered.selector);
        reg.updateConfig(signer, address(0), 0);
    }

    function test_updateConfig_changesSigner() public {
        uint256 newPk = 0xB0B;
        address newSigner = vm.addr(newPk);
        vm.startPrank(consumer);
        reg.register(signer, address(0), 0);
        reg.updateConfig(newSigner, address(0), 0);
        vm.stopPrank();

        // old signer now rejected
        vm.expectRevert(ExecutionRegistry.InvalidSignature.selector);
        _record(consumer, keccak256("i1"), "r1", signerPk);

        // new signer accepted
        _record(consumer, keccak256("i2"), "r2", newPk);
        assertEq(reg.receiptCount(consumer), 1);
    }

    // recording --------------------------------------------------------------

    function test_record_happyPath() public {
        vm.prank(consumer);
        reg.register(signer, address(0), 0);

        string memory response = "response-1";
        bytes32 intent = keccak256("intent-1");
        bytes32 attest = bytes32(uint256(0xAB));
        bytes memory payload = hex"1234";
        bytes memory sig = _sign(signerPk, response);

        // full event check, incl. emitted signedResponse + signature
        vm.expectEmit(true, true, true, true, address(reg));
        emit ExecutionRecorded(
            consumer,
            0,
            signer,
            intent,
            keccak256(bytes(response)),
            attest,
            keccak256(payload),
            uint64(block.timestamp),
            response,
            sig
        );

        vm.prank(consumer);
        uint256 idx = reg.recordExecution(intent, response, sig, attest, payload);
        assertEq(idx, 0);
        assertEq(reg.receiptCount(consumer), 1);
        assertEq(reg.totalReceipts(), 1);

        ExecutionRegistry.Receipt memory rc = reg.receiptAt(consumer, 0);
        assertEq(rc.signer, signer);
        assertEq(rc.intentHash, intent);
        assertEq(rc.responseHash, keccak256(bytes(response)));
        assertEq(rc.attestation, attest);
        assertEq(rc.payloadHash, keccak256(payload));
    }

    function test_record_revertsIfNotRegistered() public {
        vm.expectRevert(ExecutionRegistry.NotRegistered.selector);
        _record(consumer, keccak256("i"), "r", signerPk);
    }

    function test_record_revertsOnEmptyResponse() public {
        vm.prank(consumer);
        reg.register(signer, address(0), 0);
        bytes memory sig = _sign(signerPk, "");
        vm.prank(consumer);
        vm.expectRevert(ExecutionRegistry.EmptyResponse.selector);
        reg.recordExecution(keccak256("i"), "", sig, bytes32(0), hex"");
    }

    function test_record_revertsOnBadSigner() public {
        vm.prank(consumer);
        reg.register(signer, address(0), 0);
        vm.expectRevert(ExecutionRegistry.InvalidSignature.selector);
        _record(consumer, keccak256("i"), "r", 0xDEAD); // wrong key
    }

    // replay -----------------------------------------------------------------

    function test_replay_sameIntentReverts() public {
        vm.prank(consumer);
        reg.register(signer, address(0), 0);
        _record(consumer, keccak256("dup"), "resp-a", signerPk);
        // same intent, different response -> IntentAlreadyUsed
        vm.expectRevert(ExecutionRegistry.IntentAlreadyUsed.selector);
        _record(consumer, keccak256("dup"), "resp-b", signerPk);
    }

    function test_replay_sameResponseReverts() public {
        vm.prank(consumer);
        reg.register(signer, address(0), 0);
        _record(consumer, keccak256("i-1"), "same-resp", signerPk);
        // different intent, same response -> ResponseAlreadyUsed
        vm.expectRevert(ExecutionRegistry.ResponseAlreadyUsed.selector);
        _record(consumer, keccak256("i-2"), "same-resp", signerPk);
    }

    function test_replay_scopedPerConsumer() public {
        address consumerB = address(0xB00B);
        vm.prank(consumer);
        reg.register(signer, address(0), 0);
        vm.prank(consumerB);
        reg.register(signer, address(0), 0);

        _record(consumer, keccak256("shared"), "shared-resp", signerPk);
        // consumerB can reuse the same intent/response: guards are per-consumer
        _record(consumerB, keccak256("shared"), "shared-resp", signerPk);
        assertEq(reg.receiptCount(consumer), 1);
        assertEq(reg.receiptCount(consumerB), 1);
    }

    // cooldown ---------------------------------------------------------------

    function test_cooldown_enforced() public {
        vm.prank(consumer);
        reg.register(signer, address(0), 100);

        _record(consumer, keccak256("c1"), "cr1", signerPk);
        vm.expectRevert(ExecutionRegistry.CooldownNotElapsed.selector);
        _record(consumer, keccak256("c2"), "cr2", signerPk);

        vm.warp(block.timestamp + 100);
        _record(consumer, keccak256("c3"), "cr3", signerPk);
        assertEq(reg.receiptCount(consumer), 2);
    }

    function test_cooldown_zeroAllowsBackToBack() public {
        vm.prank(consumer);
        reg.register(signer, address(0), 0);
        _record(consumer, keccak256("z1"), "zr1", signerPk);
        _record(consumer, keccak256("z2"), "zr2", signerPk);
        assertEq(reg.receiptCount(consumer), 2);
    }

    // pluggable verifier -----------------------------------------------------

    function test_verifier_allowsAndDenies() public {
        MockVerifier mv = new MockVerifier();
        vm.prank(consumer);
        reg.register(address(0), address(mv), 0);

        // any signer accepted while verifier returns true
        _record(consumer, keccak256("v1"), "vr1", 0xDEAD);
        assertEq(reg.receiptCount(consumer), 1);

        mv.set(false);
        vm.expectRevert(ExecutionRegistry.InvalidSignature.selector);
        _record(consumer, keccak256("v2"), "vr2", 0xDEAD);
    }

    function test_verifier_takesPrecedenceOverSigner() public {
        MockVerifier mv = new MockVerifier();
        mv.set(false);
        // register with BOTH a valid signer and a (denying) verifier
        vm.prank(consumer);
        reg.register(signer, address(mv), 0);
        // signer matches, but verifier denies -> revert (precedence)
        vm.expectRevert(ExecutionRegistry.InvalidSignature.selector);
        _record(consumer, keccak256("p1"), "pr1", signerPk);
    }

    function test_agentInftVerifier() public {
        MockAgentSource src = new MockAgentSource();
        AgentINFTSignerVerifier ver = new AgentINFTSignerVerifier(src);
        vm.prank(consumer);
        reg.register(address(0), address(ver), 0);

        // not bound yet -> denied
        vm.expectRevert(ExecutionRegistry.InvalidSignature.selector);
        _record(consumer, keccak256("a1"), "ar1", signerPk);

        // bind consumer<->signer -> allowed
        src.bind(consumer, signer, true);
        _record(consumer, keccak256("a2"), "ar2", signerPk);
        assertEq(reg.receiptCount(consumer), 1);
    }

    // views ------------------------------------------------------------------

    function test_receipts_pagination() public {
        vm.prank(consumer);
        reg.register(signer, address(0), 0);
        _record(consumer, keccak256("g1"), "gr1", signerPk);
        _record(consumer, keccak256("g2"), "gr2", signerPk);
        _record(consumer, keccak256("g3"), "gr3", signerPk);

        assertEq(reg.receipts(consumer, 0, 2).length, 2);
        assertEq(reg.receipts(consumer, 2, 5).length, 1);
        assertEq(reg.receipts(consumer, 5, 5).length, 0);
    }

    // example consumer -------------------------------------------------------

    function test_exampleConsumer_recordsForItself() public {
        ExampleRegistryConsumer ex = new ExampleRegistryConsumer(reg, signer, 0);
        assertTrue(reg.isRegistered(address(ex)));

        bytes memory sig = _sign(signerPk, "ex-resp");
        ex.execute(keccak256("ex-intent"), "ex-resp", sig, bytes32(uint256(7)), hex"beef");

        assertEq(reg.receiptCount(address(ex)), 1);
        ExecutionRegistry.Receipt memory rc = reg.receiptAt(address(ex), 0);
        assertEq(rc.signer, signer);
    }

    function test_exampleConsumer_onlyOwner() public {
        ExampleRegistryConsumer ex = new ExampleRegistryConsumer(reg, signer, 0);
        bytes memory sig = _sign(signerPk, "ex-resp");
        vm.prank(attacker);
        vm.expectRevert(ExampleRegistryConsumer.NotOwner.selector);
        ex.execute(keccak256("ex-intent"), "ex-resp", sig, bytes32(0), hex"");
    }
}
