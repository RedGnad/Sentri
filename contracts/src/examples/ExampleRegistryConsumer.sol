// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ExecutionRegistry} from "../ExecutionRegistry.sol";

/// @title ExampleRegistryConsumer — reference integration for ExecutionRegistry
/// @notice The smallest faithful consumer of the registry, kept deliberately
///         generic so it is clearly NOT a treasury vault: it owns no funds and
///         runs no strategy. It exists to prove the registry is reusable by an
///         agent that is not Sentri's vault — a builder would replace `execute`
///         with their own on-chain action, then record the receipt exactly as
///         shown here.
///
///         This is a reference example, not a product. It does not move value.
contract ExampleRegistryConsumer {
    ExecutionRegistry public immutable registry;
    address public immutable owner;

    error NotOwner();

    constructor(ExecutionRegistry _registry, address signer, uint64 cooldown) {
        registry = _registry;
        owner = msg.sender;
        // Register this contract as a consumer with a fixed authorised signer.
        registry.register(signer, address(0), cooldown);
    }

    /// @notice Record a verifiable receipt for an action this agent executed.
    /// @dev A real consumer would perform its on-chain action (a swap, a
    ///      transfer, a vote…) and then call `recordExecution` to leave a
    ///      tamper-evident, replay-protected trail. Here we only record.
    function execute(
        bytes32 intentHash,
        string calldata signedResponse,
        bytes calldata signature,
        bytes32 attestation,
        bytes calldata payload
    ) external returns (uint256 index) {
        if (msg.sender != owner) revert NotOwner();
        // ── builder's on-chain action would go here ──
        return registry.recordExecution(intentHash, signedResponse, signature, attestation, payload);
    }
}
