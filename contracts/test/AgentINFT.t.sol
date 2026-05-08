// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentINFT} from "../src/AgentINFT.sol";

contract AgentINFTTest is Test {
    AgentINFT inft;

    address owner = address(this);
    address agentA = makeAddr("agentA");
    address agentB = makeAddr("agentB");
    address attacker = makeAddr("attacker");
    address teeSignerA = makeAddr("teeSignerA");
    address teeSignerB = makeAddr("teeSignerB");

    bytes32 constant ENCLAVE = keccak256("enclave-measurement-A");
    bytes32 constant ATTEST = keccak256("attestation-A");
    bytes32 constant META_ROOT = keccak256("0G-storage-root-A");
    address vault1 = makeAddr("vault1");
    address vault2 = makeAddr("vault2");

    function setUp() public {
        inft = new AgentINFT();
    }

    function test_mint_byOwner_setsMetadataAndOwnership() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "0G Sealed Inference", teeSignerA, META_ROOT);
        assertEq(id, 0);
        assertEq(inft.ownerOf(id), agentA);
        assertEq(inft.totalSupply(), 1);

        (bytes32 enclave, bytes32 att, string memory provider, address teeSigner, uint256 issuedAt, bool revoked, bytes32 metaRoot) =
            inft.agentMetadata(id);
        assertEq(enclave, ENCLAVE);
        assertEq(att, ATTEST);
        assertEq(provider, "0G Sealed Inference");
        assertEq(teeSigner, teeSignerA);
        assertEq(issuedAt, block.timestamp);
        assertFalse(revoked);
        assertEq(metaRoot, META_ROOT);
    }

    function test_mint_revertsIfNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        inft.mint(agentA, ENCLAVE, ATTEST, "x", teeSignerA, bytes32(0));
    }

    function test_isActiveAgent_trueAfterMint() public {
        inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        assertTrue(inft.isActiveAgent(agentA));
        assertTrue(inft.isActiveAgentWithSigner(agentA, teeSignerA));
        assertFalse(inft.isActiveAgentWithSigner(agentA, teeSignerB));
        assertFalse(inft.isActiveAgent(agentB));
    }

    function test_revoke_disablesAgent() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        inft.revoke(id);
        assertFalse(inft.isActiveAgent(agentA));
        assertFalse(inft.isActiveAgentWithSigner(agentA, teeSignerA));
    }

    function test_revoke_revertsIfAlreadyRevoked() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        inft.revoke(id);
        vm.expectRevert(AgentINFT.AlreadyRevoked.selector);
        inft.revoke(id);
    }

    function test_revoke_revertsIfNotOwner() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        vm.prank(attacker);
        vm.expectRevert();
        inft.revoke(id);
    }

    function test_reinstate_restoresActive() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        inft.revoke(id);
        assertFalse(inft.isActiveAgent(agentA));
        inft.reinstate(id);
        assertTrue(inft.isActiveAgent(agentA));
    }

    function test_reinstate_revertsIfNotRevoked() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        vm.expectRevert(AgentINFT.NotRevoked.selector);
        inft.reinstate(id);
    }

    function test_isActiveAgent_holderWithMultipleTokens_returnsTrueIfAnyActive() public {
        uint256 id1 = inft.mint(agentA, ENCLAVE, ATTEST, "p1", teeSignerA, bytes32(0));
        uint256 id2 = inft.mint(agentA, keccak256("e2"), keccak256("a2"), "p2", teeSignerB, bytes32(0));
        assertTrue(inft.isActiveAgent(agentA));
        assertTrue(inft.isActiveAgentWithSigner(agentA, teeSignerA));
        assertTrue(inft.isActiveAgentWithSigner(agentA, teeSignerB));
        // Revoke only one — still active
        inft.revoke(id1);
        assertTrue(inft.isActiveAgent(agentA));
        assertFalse(inft.isActiveAgentWithSigner(agentA, teeSignerA));
        assertTrue(inft.isActiveAgentWithSigner(agentA, teeSignerB));
        // Revoke both — inactive
        inft.revoke(id2);
        assertFalse(inft.isActiveAgent(agentA));
    }

    function test_isActiveAgent_afterTransfer_oldHolderInactive() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        assertTrue(inft.isActiveAgent(agentA));

        vm.prank(agentA);
        inft.transferFrom(agentA, agentB, id);

        assertFalse(inft.isActiveAgent(agentA));
        assertTrue(inft.isActiveAgent(agentB));
        assertTrue(inft.isActiveAgentWithSigner(agentB, teeSignerA));
    }

    /// @dev Sanity: the O(k) lookup stays cheap even with many minted tokens for OTHER agents.
    function test_isActiveAgent_scalesPerHolderNotPerSupply() public {
        // Mint 50 tokens to agentB (noise we should NOT iterate when querying agentA)
        for (uint256 i = 0; i < 50; i++) {
            inft.mint(agentB, bytes32(i), bytes32(i), "noise", teeSignerB, bytes32(0));
        }
        // agentA holds exactly 1
        inft.mint(agentA, ENCLAVE, ATTEST, "real", teeSignerA, bytes32(0));

        uint256 g0 = gasleft();
        bool active = inft.isActiveAgent(agentA);
        uint256 used = g0 - gasleft();

        assertTrue(active);
        // Per-holder lookup: agentA owns 1 token → should be cheap (well under 30k gas).
        // The O(n) version would scale with the 51 tokens minted.
        assertLt(used, 30_000, "isActiveAgent should be O(k) for the holder");
    }

    function test_totalSupply_incrementsWithMints() public {
        assertEq(inft.totalSupply(), 0);
        inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        assertEq(inft.totalSupply(), 1);
        inft.mint(agentB, keccak256("e2"), keccak256("a2"), "p2", teeSignerB, bytes32(0));
        assertEq(inft.totalSupply(), 2);
    }

    // ── v2 ERC-7857-style tests ───────────────────────────────────────────────

    function test_intelligentDataOf_returnsStoredMetadata() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "0G Sealed Inference", teeSignerA, META_ROOT);
        (bytes32 root, address signer, string memory provider) = inft.intelligentDataOf(id);
        assertEq(root, META_ROOT);
        assertEq(signer, teeSignerA);
        assertEq(provider, "0G Sealed Inference");
    }

    function test_intelligentDataOf_zeroRootIfNone() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        (bytes32 root,,) = inft.intelligentDataOf(id);
        assertEq(root, bytes32(0));
    }

    function test_updateMetadataRoot_byTokenHolder() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        bytes32 newRoot = keccak256("new-0g-root");
        vm.prank(agentA);
        inft.updateMetadataRoot(id, newRoot);
        (bytes32 root,,) = inft.intelligentDataOf(id);
        assertEq(root, newRoot);
    }

    function test_updateMetadataRoot_revertsIfNotHolder() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        vm.prank(attacker);
        vm.expectRevert(AgentINFT.NotTokenOwner.selector);
        inft.updateMetadataRoot(id, keccak256("x"));
    }

    function test_authorizeUsage_byTokenHolder() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        assertFalse(inft.isAuthorizedForVault(agentA, vault1));
        vm.prank(agentA);
        inft.authorizeUsage(id, vault1);
        assertTrue(inft.isAuthorizedForVault(agentA, vault1));
        assertFalse(inft.isAuthorizedForVault(agentA, vault2));
    }

    function test_authorizeUsage_revertsIfNotHolder() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        vm.prank(attacker);
        vm.expectRevert(AgentINFT.NotTokenOwner.selector);
        inft.authorizeUsage(id, vault1);
    }

    function test_revokeAuthorization_byTokenHolder() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        vm.startPrank(agentA);
        inft.authorizeUsage(id, vault1);
        assertTrue(inft.isAuthorizedForVault(agentA, vault1));
        inft.revokeAuthorization(id, vault1);
        assertFalse(inft.isAuthorizedForVault(agentA, vault1));
        vm.stopPrank();
    }

    function test_isAuthorizedForVault_revokedTokenReturnsFalse() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        vm.prank(agentA);
        inft.authorizeUsage(id, vault1);
        assertTrue(inft.isAuthorizedForVault(agentA, vault1));
        inft.revoke(id); // admin revokes the token
        assertFalse(inft.isAuthorizedForVault(agentA, vault1));
    }

    function test_rotateSigner_byTokenHolder() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        assertTrue(inft.isActiveAgentWithSigner(agentA, teeSignerA));
        vm.prank(agentA);
        inft.rotateSigner(id, teeSignerB);
        assertFalse(inft.isActiveAgentWithSigner(agentA, teeSignerA));
        assertTrue(inft.isActiveAgentWithSigner(agentA, teeSignerB));
    }

    function test_rotateSigner_revertsIfNotHolder() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        vm.prank(attacker);
        vm.expectRevert(AgentINFT.NotTokenOwner.selector);
        inft.rotateSigner(id, teeSignerB);
    }

    function test_rotateSigner_revertsOnZeroAddress() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p", teeSignerA, bytes32(0));
        vm.prank(agentA);
        vm.expectRevert(AgentINFT.ZeroAddress.selector);
        inft.rotateSigner(id, address(0));
    }
}
