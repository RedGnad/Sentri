// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ExecutionRegistry} from "../ExecutionRegistry.sol";
import {PythPriceAdapter} from "../oracle/PythPriceAdapter.sol";

/// @title PriceAttestedConsumer — verifiable execution bound to a verified price
/// @notice The differentiated composition of two Sentri primitives: it pulls a
///         fresh Pyth price, verifies it on-chain in the same transaction
///         (freshness + bounded confidence, via PythPriceAdapter), then records
///         an ExecutionRegistry receipt whose `payloadHash` cryptographically
///         commits to the exact verified price. The result is a tamper-evident
///         proof that the agent executed *against a fresh, verified, bounded-
///         confidence market price* — not against a stale or trusted feed.
///
///         This is a reference example, not a product. It owns no funds: a real
///         consumer would perform its on-chain action between the price read and
///         the receipt, and would key the registry off its own logic.
contract PriceAttestedConsumer is PythPriceAdapter {
    ExecutionRegistry public immutable registry;
    address public immutable owner;

    error NotOwner();
    error RefundFailed();

    /// @param _registry   Deployed ExecutionRegistry.
    /// @param signer      Authorised signer for this consumer's receipts.
    /// @param cooldown    Per-consumer cooldown (seconds).
    /// @param pyth_       Pyth pull-oracle contract.
    /// @param priceId     Pyth price feed id.
    /// @param maxAge      Max price age in seconds (<= 300).
    /// @param maxConfBps  Max confidence as bps of price (<= 1000).
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

    /// @notice Verify a fresh Pyth price and record a price-attested receipt.
    /// @dev Forward enough ETH to cover the Pyth update fee; the remainder is
    ///      refunded to the caller. The verified price is committed via the
    ///      receipt's payload (`abi.encode(price, publishTime, confBps)`), and
    ///      the feed id is the receipt's attestation reference.
    /// @return index The receipt index in the registry.
    /// @return price The verified, normalised price (8 decimals).
    function executeWithVerifiedPrice(
        bytes32 intentHash,
        string calldata signedResponse,
        bytes calldata signature,
        bytes[] calldata pythUpdateData
    ) external payable returns (uint256 index, uint256 price) {
        if (msg.sender != owner) revert NotOwner();

        uint256 publishTime;
        uint256 confBps;
        (price, publishTime, confBps) = _readPythPrice(pythUpdateData);

        // ── builder's on-chain action would go here, using `price` ──

        bytes memory payload = abi.encode(price, publishTime, confBps);
        index = registry.recordExecution(intentHash, signedResponse, signature, pythPriceId, payload);

        emit PriceAttestedExecution(index, price, publishTime, confBps);

        // Refund any ETH left after the Pyth fee.
        uint256 refund = address(this).balance;
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }

    event PriceAttestedExecution(uint256 indexed index, uint256 price, uint256 publishTime, uint256 confBps);
}
