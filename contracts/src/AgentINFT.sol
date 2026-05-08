// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentINFT v2 — ERC-7857-style Agentic Identity for TEE-attested agents
/// @notice Each INFT represents a verified agent with TEE attestation metadata
///         and an optional 0G Storage metadata root.
///         v2 adds: metadataRootHash (0G Storage blob root), intelligentDataOf,
///         per-vault authorizeUsage / revokeAuthorization, and signer rotation.
///         Pattern aligned with ERC-7857 intelligentDataOf / authorizeUsage.
contract AgentINFT is ERC721, Ownable {

    struct AgentMetadata {
        bytes32 enclaveHash;       // TEE enclave measurement hash
        bytes32 attestationHash;   // Initial TEE attestation
        string  provider;          // TEE provider (e.g. "0G Sealed Inference")
        address teeSignerAddress;  // TEE signer that signs per-chat responses
        uint256 issuedAt;          // Timestamp of minting
        bool    revoked;           // Revocation flag (soft kill)
        bytes32 metadataRootHash;  // 0G Storage blob root for agent identity data
    }

    uint256 private _nextTokenId;
    mapping(uint256 => AgentMetadata) public agentMetadata;

    /// @dev Reverse index: holder address → list of owned token IDs. Maintained on
    ///      mint/transfer so `isActiveAgent` is O(k) where k = tokens held by the
    ///      address (typically 1), not O(n) over the entire supply.
    mapping(address => uint256[]) private _holderTokens;
    /// @dev Per-token per-vault authorization map (ERC-7857 authorizeUsage pattern)
    mapping(uint256 => mapping(address => bool)) private _authorizedVaults;

    event AgentMinted(uint256 indexed tokenId, address indexed agent, bytes32 enclaveHash, address indexed teeSigner);
    event AgentRevoked(uint256 indexed tokenId);
    event AgentReinstated(uint256 indexed tokenId);
    event SignerRotated(uint256 indexed tokenId, address indexed oldSigner, address indexed newSigner);
    event UsageAuthorized(uint256 indexed tokenId, address indexed vault);
    event UsageRevoked(uint256 indexed tokenId, address indexed vault);
    event MetadataUpdated(uint256 indexed tokenId, bytes32 metadataRootHash);

    error AlreadyRevoked();
    error NotRevoked();
    error AgentTokenRevoked();
    error ZeroAddress();
    error NotTokenOwner();

    constructor() ERC721("Sentri Agent", "SAGENT") Ownable(msg.sender) {}

    modifier onlyTokenOwner(uint256 tokenId) {
        if (_ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        _;
    }

    /// @notice Mint a new Agent INFT with TEE attestation metadata
    /// @param to Agent wallet address
    /// @param enclaveHash TEE enclave measurement (identifies the code running in TEE)
    /// @param attestationHash TEE attestation hash (proves enclave integrity)
    /// @param provider TEE provider name
    /// @param teeSignerAddress TEE signer expected to sign per-chat responses
    /// @param metadataRootHash 0G Storage blob root for agent identity data (bytes32(0) if none)
    /// @return tokenId The minted token ID
    function mint(
        address to,
        bytes32 enclaveHash,
        bytes32 attestationHash,
        string calldata provider,
        address teeSignerAddress,
        bytes32 metadataRootHash
    ) external onlyOwner returns (uint256 tokenId) {
        if (to == address(0) || teeSignerAddress == address(0)) revert ZeroAddress();
        tokenId = _nextTokenId++;
        _mint(to, tokenId);

        agentMetadata[tokenId] = AgentMetadata({
            enclaveHash: enclaveHash,
            attestationHash: attestationHash,
            provider: provider,
            teeSignerAddress: teeSignerAddress,
            issuedAt: block.timestamp,
            revoked: false,
            metadataRootHash: metadataRootHash
        });

        emit AgentMinted(tokenId, to, enclaveHash, teeSignerAddress);
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

    // ── ERC-7857-style Agentic ID extensions ─────────────────────────────────

    /// @notice Returns the agent's intelligent data: 0G Storage metadata root,
    ///         active TEE signer, and provider name.
    ///         Inspired by ERC-7857 intelligentDataOf.
    function intelligentDataOf(uint256 tokenId)
        external
        view
        returns (bytes32 metadataRootHash, address teeSignerAddress, string memory provider)
    {
        AgentMetadata storage meta = agentMetadata[tokenId];
        return (meta.metadataRootHash, meta.teeSignerAddress, meta.provider);
    }

    /// @notice Authorise a vault address to use this agent token.
    ///         Only the token owner (the agent wallet) can authorise.
    ///         Inspired by ERC-7857 authorizeUsage.
    function authorizeUsage(uint256 tokenId, address vault)
        external
        onlyTokenOwner(tokenId)
    {
        if (vault == address(0)) revert ZeroAddress();
        _authorizedVaults[tokenId][vault] = true;
        emit UsageAuthorized(tokenId, vault);
    }

    /// @notice Admin-authorized vault binding. Used by VaultFactory at creation
    ///         time so the newly deployed vault is immediately authorized.
    function authorizeUsageAdmin(uint256 tokenId, address vault)
        external
        onlyOwner
    {
        if (vault == address(0)) revert ZeroAddress();
        _authorizedVaults[tokenId][vault] = true;
        emit UsageAuthorized(tokenId, vault);
    }

    /// @notice Revoke a vault's authorisation for this agent token.
    ///         Only the token owner can revoke.
    function revokeAuthorization(uint256 tokenId, address vault)
        external
        onlyTokenOwner(tokenId)
    {
        _authorizedVaults[tokenId][vault] = false;
        emit UsageRevoked(tokenId, vault);
    }

    /// @notice Returns true if `agent` holds an active, non-revoked INFT
    ///         explicitly authorized for `vault`.
    function isAuthorizedForVault(address agent, address vault) external view returns (bool) {
        uint256[] storage tokens = _holderTokens[agent];
        uint256 len = tokens.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 id = tokens[i];
            if (
                _ownerOf(id) == agent &&
                !agentMetadata[id].revoked &&
                _authorizedVaults[id][vault]
            ) {
                return true;
            }
        }
        return false;
    }

    /// @notice Rotate the TEE signer address for a token.
    ///         Admin-only: a compromised agent wallet must not be able to
    ///         replace the TEE signer that constrains it.
    function rotateSigner(uint256 tokenId, address newSigner)
        external
        onlyOwner
    {
        if (newSigner == address(0)) revert ZeroAddress();
        address oldSigner = agentMetadata[tokenId].teeSignerAddress;
        agentMetadata[tokenId].teeSignerAddress = newSigner;
        emit SignerRotated(tokenId, oldSigner, newSigner);
    }

    /// @notice Update the 0G Storage metadata root hash for a token.
    ///         Admin-only: metadata root is used as identity proof and must
    ///         not be rotatable by the agent wallet alone.
    function updateMetadataRoot(uint256 tokenId, bytes32 newMetadataRootHash)
        external
        onlyOwner
    {
        agentMetadata[tokenId].metadataRootHash = newMetadataRootHash;
        emit MetadataUpdated(tokenId, newMetadataRootHash);
    }

    /// @notice Check if an address holds an active (non-revoked) Agent INFT.
    ///         O(k) over the holder's owned tokens (typically 1), not O(n) over supply.
    /// @param agent Address to check
    /// @return True if agent holds at least one non-revoked INFT
    function isActiveAgent(address agent) external view returns (bool) {
        uint256[] storage tokens = _holderTokens[agent];
        uint256 len = tokens.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 id = tokens[i];
            if (_ownerOf(id) == agent && !agentMetadata[id].revoked) {
                return true;
            }
        }
        return false;
    }

    /// @notice Check that `agent` holds an active INFT bound to `teeSigner`.
    ///         The vault uses this to bind each signed response to the live
    ///         0G TEE signer recorded in the agent identity token.
    function isActiveAgentWithSigner(address agent, address teeSigner) external view returns (bool) {
        if (teeSigner == address(0)) return false;
        uint256[] storage tokens = _holderTokens[agent];
        uint256 len = tokens.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 id = tokens[i];
            AgentMetadata storage meta = agentMetadata[id];
            if (
                _ownerOf(id) == agent &&
                !meta.revoked &&
                meta.teeSignerAddress == teeSigner
            ) {
                return true;
            }
        }
        return false;
    }

    /// @dev Maintain the reverse holder→tokens index on every transfer/mint/burn.
    ///      Old entries become stale (owner may have moved on) but `isActiveAgent`
    ///      re-validates ownership via `_ownerOf` so staleness is harmless — at
    ///      worst we waste a bit of gas iterating over old IDs.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = super._update(to, tokenId, auth);
        if (to != address(0) && to != from) {
            _holderTokens[to].push(tokenId);
        }
        return from;
    }

    /// @notice Total supply of minted INFTs
    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }
}
