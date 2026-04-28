// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentINFT — On-chain identity for TEE-attested agents
/// @notice Each INFT represents a verified agent with TEE attestation metadata.
///         Only INFT holders can execute strategies on TreasuryVault.
contract AgentINFT is ERC721, Ownable {

    struct AgentMetadata {
        bytes32 enclaveHash;       // TEE enclave measurement hash
        bytes32 attestationHash;   // Initial TEE attestation
        string  provider;          // TEE provider (e.g. "0G Sealed Inference")
        uint256 issuedAt;          // Timestamp of minting
        bool    revoked;           // Revocation flag (soft kill)
    }

    uint256 private _nextTokenId;
    mapping(uint256 => AgentMetadata) public agentMetadata;

    event AgentMinted(uint256 indexed tokenId, address indexed agent, bytes32 enclaveHash);
    event AgentRevoked(uint256 indexed tokenId);
    event AgentReinstated(uint256 indexed tokenId);

    error AlreadyRevoked();
    error NotRevoked();
    error AgentTokenRevoked();

    constructor() ERC721("Sentri Agent", "SAGENT") Ownable(msg.sender) {}

    /// @notice Mint a new Agent INFT with TEE attestation metadata
    /// @param to Agent wallet address
    /// @param enclaveHash TEE enclave measurement (identifies the code running in TEE)
    /// @param attestationHash TEE attestation hash (proves enclave integrity)
    /// @param provider TEE provider name
    /// @return tokenId The minted token ID
    function mint(
        address to,
        bytes32 enclaveHash,
        bytes32 attestationHash,
        string calldata provider
    ) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _mint(to, tokenId);

        agentMetadata[tokenId] = AgentMetadata({
            enclaveHash: enclaveHash,
            attestationHash: attestationHash,
            provider: provider,
            issuedAt: block.timestamp,
            revoked: false
        });

        emit AgentMinted(tokenId, to, enclaveHash);
    }

    /// @notice Revoke an agent's INFT — blocks execution without burning
    /// @param tokenId Token to revoke
    function revoke(uint256 tokenId) external onlyOwner {
        if (agentMetadata[tokenId].revoked) revert AlreadyRevoked();
        agentMetadata[tokenId].revoked = true;
        emit AgentRevoked(tokenId);
    }

    /// @notice Reinstate a revoked agent
    /// @param tokenId Token to reinstate
    function reinstate(uint256 tokenId) external onlyOwner {
        if (!agentMetadata[tokenId].revoked) revert NotRevoked();
        agentMetadata[tokenId].revoked = false;
        emit AgentReinstated(tokenId);
    }

    /// @notice Check if an address holds an active (non-revoked) Agent INFT
    /// @param agent Address to check
    /// @return True if agent holds at least one active INFT
    function isActiveAgent(address agent) external view returns (bool) {
        uint256 total = _nextTokenId;
        for (uint256 i = 0; i < total; i++) {
            if (_ownerOf(i) == agent && !agentMetadata[i].revoked) {
                return true;
            }
        }
        return false;
    }

    /// @notice Total supply of minted INFTs
    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }
}
