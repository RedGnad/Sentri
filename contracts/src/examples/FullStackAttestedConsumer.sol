// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ExecutionRegistry} from "../ExecutionRegistry.sol";
import {PythPriceAdapter} from "../oracle/PythPriceAdapter.sol";

/// @title FullStackAttestedConsumer — the complete verifiable-finance receipt
/// @notice The headline composition: one on-chain receipt that binds the full
///         0G verifiable-AI stack in a single tamper-evident artifact —
///           1. TEE signer       — recovered from the receipt signature,
///           2. private reasoning — anchored by its 0G Storage root (attestation),
///           3. verified price    — fresh Pyth value, checked on-chain (payload),
///           4. timing/cooldown   — enforced by the registry.
///
///         This makes "verifiable results without revealing strategy" literal:
///         the strategy reasoning stays private in 0G Storage; only its root is
///         on-chain, alongside the verified price it acted on. Reference example,
///         not a product: it owns no funds.
contract FullStackAttestedConsumer is PythPriceAdapter {
    ExecutionRegistry public immutable registry;
    address public immutable owner;

    error NotOwner();
    error RefundFailed();

    event FullStackExecution(
        uint256 indexed index,
        uint256 price,
        uint256 publishTime,
        uint256 confBps,
        bytes32 storageRoot
    );

    constructor(
        ExecutionRegistry _registry,
        address signer,
        uint64 cooldown,
        address pyth_,
        bytes32 priceId,
        uint256 maxAge,
        uint256 maxConfBps
    ) {
        registry = _registry;
        owner = msg.sender;
        _initPythAdapter(pyth_, priceId, maxAge, maxConfBps, 8);
        registry.register(signer, address(0), cooldown);
    }

    /// @notice Verify a fresh Pyth price and record a full-stack receipt that
    ///         anchors the off-chain 0G Storage reasoning root.
    /// @param storageRoot 0G Storage root of the TEE decision/reasoning blob.
    /// @return index The receipt index in the registry.
    /// @return price The verified, normalised price (8 decimals).
    function executeFullStack(
        bytes32 intentHash,
        string calldata signedResponse,
        bytes calldata signature,
        bytes[] calldata pythUpdateData,
        bytes32 storageRoot
    ) external payable returns (uint256 index, uint256 price) {
        if (msg.sender != owner) revert NotOwner();

        uint256 publishTime;
        uint256 confBps;
        (price, publishTime, confBps) = _readPythPrice(pythUpdateData);

        // ── builder's on-chain action would go here, using `price` ──

        // attestation = 0G Storage root (anchors private reasoning);
        // payload commits the verified price tuple + the feed id.
        bytes memory payload = abi.encode(price, publishTime, confBps, pythPriceId);
        index = registry.recordExecution(intentHash, signedResponse, signature, storageRoot, payload);

        emit FullStackExecution(index, price, publishTime, confBps, storageRoot);

        uint256 refund = address(this).balance;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }
}
