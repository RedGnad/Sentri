// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal subset of the Pyth EVM pull-oracle interface used by
///         PythPriceAdapter. Only the three functions required for the
///         update-then-read pattern are included.
///
///         Full interface: https://github.com/pyth-network/pyth-sdk-solidity
library PythStructs {
    struct Price {
        int64  price;       // price value
        uint64 conf;        // confidence interval (±)
        int32  expo;        // 10^expo scale factor (typically negative, e.g. -8)
        uint   publishTime; // unix timestamp of this price
    }
}

interface IPyth {
    /// @notice Returns the fee (in wei) required to update the given price feeds.
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 fee);

    /// @notice Submit Wormhole-signed price update data. Must be called with
    ///         msg.value >= getUpdateFee(updateData).
    function updatePriceFeeds(bytes[] calldata updateData) external payable;

    /// @notice Read the latest price for `id` that was published within `age` seconds.
    ///         Reverts if no update has been submitted within the age window.
    function getPriceNoOlderThan(bytes32 id, uint256 age)
        external
        view
        returns (PythStructs.Price memory price);
}
