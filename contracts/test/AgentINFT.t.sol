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

    bytes32 constant ENCLAVE = keccak256("enclave-measurement-A");
    bytes32 constant ATTEST = keccak256("attestation-A");

    function setUp() public {
        inft = new AgentINFT();
    }

    function test_mint_byOwner_setsMetadataAndOwnership() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "0G Sealed Inference");
        assertEq(id, 0);
        assertEq(inft.ownerOf(id), agentA);
        assertEq(inft.totalSupply(), 1);

        (bytes32 enclave, bytes32 att, string memory provider, uint256 issuedAt, bool revoked) =
            inft.agentMetadata(id);
        assertEq(enclave, ENCLAVE);
        assertEq(att, ATTEST);
        assertEq(provider, "0G Sealed Inference");
        assertEq(issuedAt, block.timestamp);
        assertFalse(revoked);
    }

    function test_mint_revertsIfNotOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        inft.mint(agentA, ENCLAVE, ATTEST, "x");
    }

    function test_isActiveAgent_trueAfterMint() public {
        inft.mint(agentA, ENCLAVE, ATTEST, "p");
        assertTrue(inft.isActiveAgent(agentA));
        assertFalse(inft.isActiveAgent(agentB));
    }

    function test_revoke_disablesAgent() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p");
        inft.revoke(id);
        assertFalse(inft.isActiveAgent(agentA));
    }

    function test_revoke_revertsIfAlreadyRevoked() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p");
        inft.revoke(id);
        vm.expectRevert(AgentINFT.AlreadyRevoked.selector);
        inft.revoke(id);
    }

    function test_revoke_revertsIfNotOwner() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p");
        vm.prank(attacker);
        vm.expectRevert();
        inft.revoke(id);
    }

    function test_reinstate_restoresActive() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p");
        inft.revoke(id);
        assertFalse(inft.isActiveAgent(agentA));
        inft.reinstate(id);
        assertTrue(inft.isActiveAgent(agentA));
    }

    function test_reinstate_revertsIfNotRevoked() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p");
        vm.expectRevert(AgentINFT.NotRevoked.selector);
        inft.reinstate(id);
    }

    function test_isActiveAgent_holderWithMultipleTokens_returnsTrueIfAnyActive() public {
        uint256 id1 = inft.mint(agentA, ENCLAVE, ATTEST, "p1");
        uint256 id2 = inft.mint(agentA, keccak256("e2"), keccak256("a2"), "p2");
        assertTrue(inft.isActiveAgent(agentA));
        // Revoke only one — still active
        inft.revoke(id1);
        assertTrue(inft.isActiveAgent(agentA));
        // Revoke both — inactive
        inft.revoke(id2);
        assertFalse(inft.isActiveAgent(agentA));
    }

    function test_isActiveAgent_afterTransfer_oldHolderInactive() public {
        uint256 id = inft.mint(agentA, ENCLAVE, ATTEST, "p");
        assertTrue(inft.isActiveAgent(agentA));

        vm.prank(agentA);
        inft.transferFrom(agentA, agentB, id);

        assertFalse(inft.isActiveAgent(agentA));
        assertTrue(inft.isActiveAgent(agentB));
    }

    /// @dev Sanity: the O(k) lookup stays cheap even with many minted tokens for OTHER agents.
    function test_isActiveAgent_scalesPerHolderNotPerSupply() public {
        // Mint 50 tokens to agentB (noise we should NOT iterate when querying agentA)
        for (uint256 i = 0; i < 50; i++) {
            inft.mint(agentB, bytes32(i), bytes32(i), "noise");
        }
        // agentA holds exactly 1
        inft.mint(agentA, ENCLAVE, ATTEST, "real");

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
        inft.mint(agentA, ENCLAVE, ATTEST, "p");
        assertEq(inft.totalSupply(), 1);
        inft.mint(agentB, keccak256("e2"), keccak256("a2"), "p2");
        assertEq(inft.totalSupply(), 2);
    }
}
