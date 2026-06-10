// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title ISignerVerifier — pluggable authorisation for execution receipts
/// @notice Lets a consumer delegate "is this signer allowed to authorise a
///         receipt for me?" to an external contract (e.g. an AgentINFT-backed
///         check) instead of a single fixed signer address. The registry calls
///         this only when a consumer has registered with a verifier.
interface ISignerVerifier {
    /// @param consumer The contract/operator that recorded the execution.
    /// @param signer   The address recovered from the receipt signature.
    /// @return ok      True if `signer` may authorise receipts for `consumer`.
    function isValidSigner(address consumer, address signer) external view returns (bool ok);
}

/// @title ExecutionRegistry — verifiable, replay-protected execution receipts
/// @notice A permissionless, shared on-chain registry where any agent can record
///         a tamper-evident receipt for an off-chain decision it executed. Each
///         receipt is authorised by a signature (the same EIP-191 scheme Sentri's
///         vault uses for its TEE-signed responses), de-duplicated against replay,
///         and rate-limited by a per-consumer cooldown. Anyone can read the
///         receipts back and re-verify them off-chain.
///
///         This is the reusable kernel of Sentri's on-chain guardrail: the
///         verifiable-execution + audit-log pattern, generalised so any builder's
///         agent can plug in. It does NOT include Sentri's portfolio risk policy
///         (allocation / drawdown), which is vault-specific and stays in the vault.
///
///         Usage:
///           1. A consumer (a contract or an operator EOA) calls `register` with
///              either a fixed authorised `signer` or a `verifier` contract, plus
///              an optional `cooldown`.
///           2. On each executed decision it calls `recordExecution` with the
///              signed response, its signature, a single-use intent hash, and an
///              attestation reference. The registry verifies, de-dups, enforces
///              the cooldown, stores the receipt and emits an event.
contract ExecutionRegistry {
    // ── Types ────────────────────────────────────────────────────────────

    struct Config {
        address signer;       // authorised signer when `verifier` is unset
        address verifier;     // optional ISignerVerifier; takes precedence over `signer`
        uint64 cooldown;      // min seconds between receipts (0 = no cooldown)
        uint64 lastExecutionAt; // timestamp of the most recent receipt
        bool registered;      // distinguishes an unset config from a zero cooldown
    }

    struct Receipt {
        uint64 timestamp;     // block time the receipt was recorded
        address signer;       // signer recovered from the receipt signature
        bytes32 intentHash;   // single-use identifier of the executed intent
        bytes32 responseHash; // keccak256 of the signed response payload
        bytes32 attestation;  // off-chain attestation reference (e.g. TEE quote hash)
        bytes32 payloadHash;  // keccak256 of the opaque execution payload
    }

    // ── State ────────────────────────────────────────────────────────────

    /// @notice Per-consumer authorisation + rate-limit configuration.
    mapping(address consumer => Config) public configs;

    /// @notice Append-only receipts per consumer.
    mapping(address consumer => Receipt[]) private _receipts;

    /// @notice Replay guards, scoped per consumer.
    mapping(address consumer => mapping(bytes32 intentHash => bool)) public usedIntent;
    mapping(address consumer => mapping(bytes32 responseHash => bool)) public usedResponse;

    /// @notice Total receipts recorded across all consumers (monotonic).
    uint256 public totalReceipts;

    // ── Events ───────────────────────────────────────────────────────────

    event ConsumerRegistered(address indexed consumer, address signer, address verifier, uint64 cooldown);
    event ConsumerUpdated(address indexed consumer, address signer, address verifier, uint64 cooldown);

    /// @dev `signedResponse` and `signature` are emitted (not stored) so any
    ///      receipt is independently re-verifiable from logs alone: recompute
    ///      keccak256(signedResponse), recover the signer, compare to the stored
    ///      receipt. Storage keeps only the hashes.
    event ExecutionRecorded(
        address indexed consumer,
        uint256 indexed index,
        address indexed signer,
        bytes32 intentHash,
        bytes32 responseHash,
        bytes32 attestation,
        bytes32 payloadHash,
        uint64 timestamp,
        string signedResponse,
        bytes signature
    );

    // ── Errors ───────────────────────────────────────────────────────────

    error AlreadyRegistered();
    error NotRegistered();
    error NoAuthoriserConfigured();
    error InvalidSignature();
    error IntentAlreadyUsed();
    error ResponseAlreadyUsed();
    error CooldownNotElapsed();
    error EmptyResponse();

    // ── Registration ─────────────────────────────────────────────────────

    /// @notice Register the caller as a consumer.
    /// @dev Set exactly one authoriser: a fixed `signer` OR a `verifier`. If
    ///      `verifier` is non-zero it takes precedence and `signer` may be zero.
    /// @param signer   Authorised signer address (used when `verifier` is zero).
    /// @param verifier Optional ISignerVerifier contract; zero to use `signer`.
    /// @param cooldown Minimum seconds between receipts (0 disables the limit).
    function register(address signer, address verifier, uint64 cooldown) external {
        Config storage c = configs[msg.sender];
        if (c.registered) revert AlreadyRegistered();
        if (signer == address(0) && verifier == address(0)) revert NoAuthoriserConfigured();
        c.signer = signer;
        c.verifier = verifier;
        c.cooldown = cooldown;
        c.registered = true;
        emit ConsumerRegistered(msg.sender, signer, verifier, cooldown);
    }

    /// @notice Update the caller's authoriser and/or cooldown.
    /// @dev Same one-of-two-authorisers rule as `register`. Does not reset the
    ///      cooldown clock or any replay guards.
    function updateConfig(address signer, address verifier, uint64 cooldown) external {
        Config storage c = configs[msg.sender];
        if (!c.registered) revert NotRegistered();
        if (signer == address(0) && verifier == address(0)) revert NoAuthoriserConfigured();
        c.signer = signer;
        c.verifier = verifier;
        c.cooldown = cooldown;
        emit ConsumerUpdated(msg.sender, signer, verifier, cooldown);
    }

    // ── Recording ────────────────────────────────────────────────────────

    /// @notice Record a verifiable receipt for an executed decision.
    /// @dev Checks-effects pattern: all guards and state writes happen here with
    ///      no external calls except the optional, view-only verifier.
    /// @param intentHash    Single-use identifier of the intent being executed.
    /// @param signedResponse The off-chain decision payload that was signed.
    /// @param signature     EIP-191 signature over `signedResponse`.
    /// @param attestation   Off-chain attestation reference (e.g. TEE quote hash).
    /// @param payload       Opaque execution payload; only its hash is stored.
    /// @return index        The receipt's index within the consumer's history.
    function recordExecution(
        bytes32 intentHash,
        string calldata signedResponse,
        bytes calldata signature,
        bytes32 attestation,
        bytes calldata payload
    ) external returns (uint256 index) {
        Config storage c = configs[msg.sender];
        if (!c.registered) revert NotRegistered();
        if (bytes(signedResponse).length == 0) revert EmptyResponse();

        // Cooldown.
        if (c.cooldown != 0 && c.lastExecutionAt != 0) {
            if (block.timestamp < uint256(c.lastExecutionAt) + uint256(c.cooldown)) {
                revert CooldownNotElapsed();
            }
        }

        // Recover and authorise the signer.
        bytes32 responseHash = keccak256(bytes(signedResponse));
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(signedResponse));
        address signer = ECDSA.recover(digest, signature);
        if (c.verifier != address(0)) {
            if (!ISignerVerifier(c.verifier).isValidSigner(msg.sender, signer)) revert InvalidSignature();
        } else if (signer != c.signer) {
            revert InvalidSignature();
        }

        // Replay guards.
        if (usedIntent[msg.sender][intentHash]) revert IntentAlreadyUsed();
        if (usedResponse[msg.sender][responseHash]) revert ResponseAlreadyUsed();
        usedIntent[msg.sender][intentHash] = true;
        usedResponse[msg.sender][responseHash] = true;

        // Effects.
        c.lastExecutionAt = uint64(block.timestamp);
        bytes32 payloadHash = keccak256(payload);
        index = _receipts[msg.sender].length;
        _receipts[msg.sender].push(Receipt({
            timestamp: uint64(block.timestamp),
            signer: signer,
            intentHash: intentHash,
            responseHash: responseHash,
            attestation: attestation,
            payloadHash: payloadHash
        }));
        unchecked { totalReceipts++; }

        emit ExecutionRecorded(
            msg.sender,
            index,
            signer,
            intentHash,
            responseHash,
            attestation,
            payloadHash,
            uint64(block.timestamp),
            signedResponse,
            signature
        );
    }

    // ── Views ────────────────────────────────────────────────────────────

    /// @notice Number of receipts a consumer has recorded.
    function receiptCount(address consumer) external view returns (uint256) {
        return _receipts[consumer].length;
    }

    /// @notice Read a single receipt by index.
    function receiptAt(address consumer, uint256 index) external view returns (Receipt memory) {
        return _receipts[consumer][index];
    }

    /// @notice Read a bounded slice of a consumer's receipts (newest-agnostic;
    ///         returns receipts in recorded order from `start`).
    /// @param start Index to start from.
    /// @param limit Max number of receipts to return.
    function receipts(address consumer, uint256 start, uint256 limit)
        external
        view
        returns (Receipt[] memory page)
    {
        Receipt[] storage all = _receipts[consumer];
        uint256 len = all.length;
        if (start >= len) return new Receipt[](0);
        uint256 end = start + limit;
        if (end < start || end > len) end = len; // clamp + overflow guard
        page = new Receipt[](end - start);
        for (uint256 i = start; i < end; i++) {
            page[i - start] = all[i];
        }
    }

    /// @notice Whether a consumer is registered.
    function isRegistered(address consumer) external view returns (bool) {
        return configs[consumer].registered;
    }
}
