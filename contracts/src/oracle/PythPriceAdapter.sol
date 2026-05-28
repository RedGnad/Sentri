// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPyth, PythStructs} from "./IPyth.sol";

/// @title PythPriceAdapter — abstract mixin for Pyth pull-oracle price reads
/// @notice Inherit this in any contract that needs to verify a Pyth price
///         on-chain in the same transaction. Stores Pyth configuration as
///         immutable-equivalent state (set once at construction/init).
///
///         The one public surface is `_readPythPrice(updateData)`: it updates
///         the Pyth contract, reads the verified price, normalises it to
///         `outputDecimals`, and enforces freshness + confidence.
abstract contract PythPriceAdapter {
    // ── Storage ──────────────────────────────────────────────────────────

    IPyth   public pyth;              // Pyth pull-oracle contract
    bytes32 public pythPriceId;       // e.g. ETH/USD feed id
    uint256 public pythMaxAge;        // max seconds since price publish time
    uint256 public pythMaxConfBps;    // max confidence as bps of price (e.g. 200 = 2%)
    uint8   public pythOutputDecimals; // decimal precision of normalised price (8 matches SentriPriceFeed)

    // ── Events ───────────────────────────────────────────────────────────

    /// @notice Emitted every time a Pyth price update is successfully verified.
    event PythPriceVerified(
        bytes32 indexed priceId,
        uint256 normalizedPrice,
        uint256 publishTime,
        uint256 confBps
    );

    // ── Errors ───────────────────────────────────────────────────────────

    error PythUpdateDataEmpty();
    error PythFeeTooLow(uint256 required, uint256 provided);
    error PythPriceInvalid();
    error PythPriceStale(uint256 publishTime, uint256 maxAge);
    error PythConfidenceTooWide(uint256 confBps, uint256 maxConfBps);

    // ── Internal — called by the concrete vault's executeStrategyWithPyth ──

    /// @notice Submit `updateData` to the Pyth contract, read back the
    ///         verified price, and return it in normalised form.
    ///
    /// @param updateData  Wormhole-signed VAA array fetched from Hermes.
    /// @return normalizedPrice  Price in base/risk units with `pythOutputDecimals` precision.
    /// @return publishTime      Unix timestamp of the price observation.
    /// @return confBps          Confidence interval as basis points of price.
    function _readPythPrice(bytes[] calldata updateData)
        internal
        returns (
            uint256 normalizedPrice,
            uint256 publishTime,
            uint256 confBps
        )
    {
        if (updateData.length == 0) revert PythUpdateDataEmpty();

        // 1. Compute required fee — must have been forwarded by caller.
        uint256 fee = pyth.getUpdateFee(updateData);
        if (msg.value < fee) revert PythFeeTooLow(fee, msg.value);

        // 2. Push the signed update on-chain (idempotent if already fresh).
        pyth.updatePriceFeeds{value: fee}(updateData);

        // 3. Read the now-guaranteed-fresh price; reverts if stale.
        PythStructs.Price memory p = pyth.getPriceNoOlderThan(pythPriceId, pythMaxAge);

        // 4. Sanity checks on the price value.
        if (p.price <= 0) revert PythPriceInvalid();

        // 5. Normalise to pythOutputDecimals.
        //    p.expo is typically negative (e.g. -8 means price is in 1e-8 units).
        //    target = p.price * 10^expo * 10^outputDecimals
        //           = p.price * 10^(expo + outputDecimals)
        int32 shift = int32(int8(pythOutputDecimals)) + p.expo;
        if (shift >= 0) {
            normalizedPrice = uint256(int256(p.price)) * (10 ** uint32(shift));
        } else {
            normalizedPrice = uint256(int256(p.price)) / (10 ** uint32(-shift));
        }

        // 6. Confidence in basis points: conf / |price| * 10_000.
        //    conf is always positive (uint64); p.price > 0 checked above.
        confBps = (uint256(p.conf) * 10_000) / uint256(int256(p.price));
        if (confBps > pythMaxConfBps) revert PythConfidenceTooWide(confBps, pythMaxConfBps);

        publishTime = p.publishTime;

        emit PythPriceVerified(pythPriceId, normalizedPrice, publishTime, confBps);
    }

    // ── Internal — init helper (called by concrete vault's initializer) ──

    function _initPythAdapter(
        address _pyth,
        bytes32 _priceId,
        uint256 _maxAge,
        uint256 _maxConfBps,
        uint8   _outputDecimals
    ) internal {
        require(_pyth != address(0), "PythAdapter: zero pyth");
        require(_priceId != bytes32(0), "PythAdapter: zero priceId");
        require(_maxAge > 0 && _maxAge <= 300, "PythAdapter: maxAge out of range");
        require(_maxConfBps > 0 && _maxConfBps <= 1000, "PythAdapter: maxConfBps out of range");
        pyth               = IPyth(_pyth);
        pythPriceId        = _priceId;
        pythMaxAge         = _maxAge;
        pythMaxConfBps     = _maxConfBps;
        pythOutputDecimals = _outputDecimals;
    }
}
