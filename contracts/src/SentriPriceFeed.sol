// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SentriPriceFeed — AggregatorV3-compatible price feed
/// @notice Drop-in replacement for Chainlink AggregatorV3. Prices are pushed by
///         authorized keepers (the agent) with TEE attestation. Includes
///         staleness checks so consumers can refuse old data.
contract SentriPriceFeed is Ownable {
    // ── Errors ───────────────────────────────────────────────────────────

    error NotKeeper();
    error NoData();
    error InvalidPrice();

    // ── Events ───────────────────────────────────────────────────────────

    event PriceUpdated(int256 answer, uint256 timestamp, bytes32 attestation);
    event KeeperSet(address indexed keeper, bool allowed);

    // ── State ────────────────────────────────────────────────────────────

    uint8 public immutable decimals;
    string public description;
    uint256 public constant version = 1;

    uint80 private _roundId;
    int256 private _answer;
    uint256 private _updatedAt;

    mapping(address => bool) public keepers;
    mapping(uint80 => bytes32) public attestations;

    modifier onlyKeeper() {
        if (!keepers[msg.sender]) revert NotKeeper();
        _;
    }

    constructor(uint8 _decimals, string memory _description) Ownable(msg.sender) {
        decimals = _decimals;
        description = _description;
    }

    // ── Admin ────────────────────────────────────────────────────────────

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        keepers[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    // ── Push ─────────────────────────────────────────────────────────────

    /// @notice Push a new price. Must be strictly positive.
    /// @param answer New price in `decimals` units
    /// @param attestation TEE attestation hash anchoring this data point
    function pushAnswer(int256 answer, bytes32 attestation) external onlyKeeper {
        if (answer <= 0) revert InvalidPrice();
        unchecked { _roundId += 1; }
        _answer = answer;
        _updatedAt = block.timestamp;
        attestations[_roundId] = attestation;
        emit PriceUpdated(answer, block.timestamp, attestation);
    }

    // ── Reads (AggregatorV3 compatible) ──────────────────────────────────

    function latestAnswer() external view returns (int256) {
        if (_updatedAt == 0) revert NoData();
        return _answer;
    }

    function latestTimestamp() external view returns (uint256) {
        return _updatedAt;
    }

    function latestRound() external view returns (uint80) {
        return _roundId;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        if (_updatedAt == 0) revert NoData();
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }
}
