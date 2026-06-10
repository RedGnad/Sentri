// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISignerVerifier} from "./ExecutionRegistry.sol";

/// @notice Minimal view-only source of agent/signer bindings. AgentINFT
///         implements this (it exposes `isActiveAgentWithSigner`), so the
///         verifier can authorise receipts against live 0G TEE signer identities
///         without the registry depending on the full AgentINFT contract.
interface IAgentSignerSource {
    function isActiveAgentWithSigner(address agent, address teeSigner) external view returns (bool);
}

/// @title AgentINFTSignerVerifier — ISignerVerifier backed by AgentINFT
/// @notice Drop-in verifier for ExecutionRegistry. A consumer that registers
///         with this verifier delegates authorisation to its AgentINFT identity:
///         a receipt is valid only if the recovered signer is the active TEE
///         signer bound to the consumer's INFT. This is how Sentri-style agents
///         plug into the shared registry; other builders can register a fixed
///         signer instead and skip AgentINFT entirely.
contract AgentINFTSignerVerifier is ISignerVerifier {
    IAgentSignerSource public immutable agentNFT;

    constructor(IAgentSignerSource _agentNFT) {
        agentNFT = _agentNFT;
    }

    /// @inheritdoc ISignerVerifier
    function isValidSigner(address consumer, address signer) external view returns (bool) {
        return agentNFT.isActiveAgentWithSigner(consumer, signer);
    }
}
