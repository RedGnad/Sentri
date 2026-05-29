// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {AgentINFT} from "./AgentINFT.sol";
import {SentriSwapRouter} from "./SentriSwapRouter.sol";
import {PythPriceAdapter} from "./oracle/PythPriceAdapter.sol";

/// @title TreasuryVaultTrustlessOracle
/// @notice Trustless variant of TreasuryVault. The keeper-pushed SentriPriceFeed
///         is removed from the execution path. Every funds-moving call carries a
///         Pyth-signed price update that is verified on-chain — in the same
///         transaction — before policy checks and swap execution.
///
///         Sentri Trustless Oracle Vault removes the keeper-pushed price feed
///         from the execution path. Every funds-moving execution carries a
///         Pyth-signed price update, verified on-chain in the same transaction
///         before policy checks and swap execution.
///
///         Standard path (SentriPriceFeed) is intentionally absent.
///         Only executeStrategyWithPyth() may move funds.
contract TreasuryVaultTrustlessOracle is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuard,
    PythPriceAdapter
{
    using SafeERC20 for IERC20;

    // ── Types ────────────────────────────────────────────────────────────

    struct Policy {
        uint16 maxAllocationBps;
        uint16 maxDrawdownBps;
        uint16 rebalanceThresholdBps;
        uint16 maxSlippageBps;
        uint32 cooldownPeriod;
        uint32 maxPriceStaleness; // maps to Pyth maxAge in this contract
    }

    enum Action {
        Rebalance,
        YieldFarm,
        EmergencyDeleverage
    }

    struct ExecutionLog {
        uint256 timestamp;
        Action  action;
        uint256 amountIn;
        uint256 amountOut;
        uint256 tvlAfter;
        bytes32 intentHash;
        bytes32 responseHash;
        address teeSigner;
        bytes32 teeAttestation;
        uint256 deadline;
        // trustless-oracle extras
        uint256 pythPrice;
        uint256 pythPublishTime;
        uint256 pythConfBps;
    }

    struct TrustlessInitParams {
        address owner;
        address base;
        address risk;
        address agentNFT;
        address router;
        address agent;
        Policy  policy;
        // Pyth
        address pyth;
        bytes32 pythPriceId;
        uint256 pythMaxAge;
        uint256 pythMaxConfBps;
    }

    // ── State ────────────────────────────────────────────────────────────

    IERC20 public base;
    IERC20 public risk;
    uint8  public baseDecimals;
    uint8  public riskDecimals;

    AgentINFT       public agentNFT;
    SentriSwapRouter public router;

    address public agent;
    address public factory;
    Policy  public policy;

    uint256 public highWaterMark;
    uint256 public lastExecutionTime;

    ExecutionLog[] public executionLogs;
    bool           public killed;

    mapping(bytes32 => bool) public usedIntentHashes;
    mapping(bytes32 => bool) public usedResponseHashes;

    // ── Events ───────────────────────────────────────────────────────────

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    event TrustlessOracleExecution(
        address indexed vault,
        address indexed agent,
        bytes32 indexed intentHash,
        bytes32         responseHash,
        bytes32         pythPriceId,
        uint256         pythPrice,
        uint256         pythPublishTime,
        uint256         pythConfBps,
        uint256         amountIn,
        uint256         amountOut,
        uint256         timestamp
    );

    event PolicyUpdated(Policy newPolicy);
    event AgentUpdated(address newAgent);
    event EmergencyKillSwitchActivated(address indexed by, uint256 baseWithdrawn, uint256 riskWithdrawn);

    // ── Errors ───────────────────────────────────────────────────────────

    error NotAgent();
    error AgentNotVerified();
    error VaultKilled();
    error ZeroAmount();
    error ZeroAddress();
    error CooldownNotElapsed();
    error AllocationExceeded();
    error DrawdownBreached();
    error InvalidPolicy();
    error InsufficientRiskBalance();
    error NotFactory();
    error InvalidTEESignature();
    error IntentAlreadyUsed();
    error ResponseAlreadyUsed();
    error ExpiredIntent();
    error AgentNotAuthorizedForVault();

    // ── Modifiers ────────────────────────────────────────────────────────

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        if (!agentNFT.isActiveAgent(msg.sender)) revert AgentNotVerified();
        if (!agentNFT.isAuthorizedForVault(msg.sender, address(this))) revert AgentNotAuthorizedForVault();
        _;
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert NotFactory();
        _;
    }

    modifier notKilled() {
        if (killed) revert VaultKilled();
        _;
    }

    // ── Constructor / Initializer ────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-shot initialization. Called by VaultFactoryV2 after clone deploy.
    function initialize(TrustlessInitParams calldata p) external initializer {
        if (
            p.owner    == address(0) ||
            p.base     == address(0) ||
            p.risk     == address(0) ||
            p.agentNFT == address(0) ||
            p.router   == address(0) ||
            p.agent    == address(0) ||
            p.pyth     == address(0)
        ) revert ZeroAddress();
        _validatePolicy(p.policy);

        __Ownable_init(p.owner);
        __Pausable_init();

        base         = IERC20(p.base);
        risk         = IERC20(p.risk);
        baseDecimals = IERC20Metadata(p.base).decimals();
        riskDecimals = IERC20Metadata(p.risk).decimals();
        agentNFT     = AgentINFT(p.agentNFT);
        router       = SentriSwapRouter(p.router);
        agent        = p.agent;
        factory      = msg.sender;
        policy       = p.policy;

        // 8 decimals to match SentriPriceFeed convention so quoting math is identical.
        _initPythAdapter(p.pyth, p.pythPriceId, p.pythMaxAge, p.pythMaxConfBps, 8);
    }

    // ── Deposit / Withdraw ───────────────────────────────────────────────

    function deposit(uint256 amount) external whenNotPaused notKilled nonReentrant {
        _depositFrom(msg.sender, amount);
    }

    function depositFrom(address payer, uint256 amount)
        external
        onlyFactory
        whenNotPaused
        notKilled
        nonReentrant
    {
        _depositFrom(payer, amount);
    }

    function _depositFrom(address payer, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        if (payer  == address(0)) revert ZeroAddress();
        base.safeTransferFrom(payer, address(this), amount);
        // HWM bump: no priceFeed available outside execution; use base balance.
        uint256 b = base.balanceOf(address(this));
        if (b > highWaterMark) highWaterMark = b;
        emit Deposited(payer, amount);
    }

    /// @notice Withdraw base tokens. HWM is scaled down proportionally.
    ///         Price not available here; uses base balance as TVL proxy.
    function withdraw(address to, uint256 amount)
        external
        onlyOwner
        whenNotPaused
        notKilled
        nonReentrant
    {
        if (to     == address(0)) revert ZeroAddress();
        if (amount == 0)          revert ZeroAmount();

        uint256 baseBefore = base.balanceOf(address(this));
        base.safeTransfer(to, amount);

        if (highWaterMark > 0 && baseBefore > 0) {
            uint256 baseAfter = base.balanceOf(address(this));
            highWaterMark = (highWaterMark * baseAfter) / baseBefore;
        }
        emit Withdrawn(to, amount);
    }

    // ── Trustless Execution ──────────────────────────────────────────────

    /// @notice Execute a strategy action.
    ///         The `pythUpdateData` array is submitted to the Pyth contract in
    ///         the same transaction; the verified on-chain price is then used for
    ///         all policy checks and slippage enforcement. SentriPriceFeed is
    ///         never read.
    ///
    /// @param action          0=Rebalance  1=YieldFarm  2=EmergencyDeleverage
    /// @param amountIn        Base (buy) or risk (sell) amount
    /// @param intentHash      Hash of the 0G Storage intent document
    /// @param signedResponse  TEE-signed JSON response
    /// @param teeSignature    EIP-191 signature over `signedResponse`
    /// @param teeAttestation  TEE attestation hash
    /// @param deadline        TX expiry (unix seconds)
    /// @param pythUpdateData  Hermes-fetched VAAs for the Pyth pull oracle
    function executeStrategyWithPyth(
        Action         action,
        uint256        amountIn,
        bytes32        intentHash,
        string calldata signedResponse,
        bytes  calldata teeSignature,
        bytes32        teeAttestation,
        uint256        deadline,
        bytes[] calldata pythUpdateData
    ) external payable onlyAgent whenNotPaused notKilled nonReentrant {
        // ── 1-6: Authorization and anti-replay ────────────────────────────

        if (amountIn == 0)                    revert ZeroAmount();
        if (block.timestamp > deadline)       revert ExpiredIntent();
        if (usedIntentHashes[intentHash])     revert IntentAlreadyUsed();

        (address teeSigner, bytes32 responseHash) = _verifyTEE(signedResponse, teeSignature);
        if (usedResponseHashes[responseHash]) revert ResponseAlreadyUsed();

        _enforceCooldown();

        // Checks-effects: advance state BEFORE external calls.
        lastExecutionTime               = block.timestamp;
        usedIntentHashes[intentHash]    = true;
        usedResponseHashes[responseHash] = true;

        // ── 7: Verify Pyth price on-chain (updates + reads in same tx) ────

        (uint256 price, uint256 publishTime, uint256 confBps) = _readPythPrice(pythUpdateData);
        // price is in outputDecimals (8) — same convention as SentriPriceFeed.

        // ── 8-10: Swap + policy enforcement ──────────────────────────────

        uint256 amountOut;
        if (action == Action.EmergencyDeleverage) {
            if (risk.balanceOf(address(this)) < amountIn) revert InsufficientRiskBalance();
            uint256 expectedBase = _quoteRiskToBase(amountIn, price);
            uint256 minOut       = (expectedBase * (10_000 - policy.maxSlippageBps)) / 10_000;
            amountOut = _doSwap(address(risk), amountIn, minOut);
        } else {
            if (base.balanceOf(address(this)) < amountIn) revert ZeroAmount();
            uint256 expectedRisk = _quoteBaseToRisk(amountIn, price);
            uint256 minOut       = (expectedRisk * (10_000 - policy.maxSlippageBps)) / 10_000;
            amountOut = _doSwap(address(base), amountIn, minOut);
        }

        uint256 tvlAfter = _tvl(price);
        if (action != Action.EmergencyDeleverage) {
            _enforceRiskExposure(tvlAfter, price);
        }
        _enforceDrawdown(tvlAfter);

        if (tvlAfter > highWaterMark) highWaterMark = tvlAfter;

        // ── 11: Emit audit event with oracle proof fields ─────────────────

        uint256 logIndex = executionLogs.length;
        executionLogs.push(ExecutionLog({
            timestamp:      block.timestamp,
            action:         action,
            amountIn:       amountIn,
            amountOut:      amountOut,
            tvlAfter:       tvlAfter,
            intentHash:     intentHash,
            responseHash:   responseHash,
            teeSigner:      teeSigner,
            teeAttestation: teeAttestation,
            deadline:       deadline,
            pythPrice:      price,
            pythPublishTime: publishTime,
            pythConfBps:    confBps
        }));

        emit TrustlessOracleExecution({
            vault:           address(this),
            agent:           msg.sender,
            intentHash:      intentHash,
            responseHash:    responseHash,
            pythPriceId:     pythPriceId,
            pythPrice:       price,
            pythPublishTime: publishTime,
            pythConfBps:     confBps,
            amountIn:        amountIn,
            amountOut:       amountOut,
            timestamp:       block.timestamp
        });

        // Refund any ETH left after the Pyth fee (fee may be lower than msg.value).
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            // slither-disable-next-line arbitrary-send-eth
            (bool ok,) = msg.sender.call{value: remaining}("");
            // Non-critical: if refund fails we keep the dust in the vault.
            ok; // silence unused-var warning
        }

        (logIndex); // reference to suppress unused warning
    }

    // ── Kill-Switch ──────────────────────────────────────────────────────

    function emergencyWithdraw() external onlyOwner nonReentrant {
        killed = true;
        uint256 b = base.balanceOf(address(this));
        uint256 r = risk.balanceOf(address(this));
        if (b > 0) base.safeTransfer(owner(), b);
        if (r > 0) risk.safeTransfer(owner(), r);
        emit EmergencyKillSwitchActivated(msg.sender, b, r);
    }

    function emergencyDeleverageAndWithdraw(uint256 minBaseOut) external onlyOwner nonReentrant {
        killed = true;
        uint256 riskBefore = risk.balanceOf(address(this));
        if (riskBefore > 0) {
            IERC20(address(risk)).forceApprove(address(router), riskBefore);
            router.swapExactTokensForTokens(
                address(risk),
                riskBefore,
                minBaseOut,
                address(this),
                block.timestamp + 300
            );
        }
        uint256 b = base.balanceOf(address(this));
        if (b > 0) base.safeTransfer(owner(), b);
        emit EmergencyKillSwitchActivated(msg.sender, b, riskBefore);
    }

    // ── Pause ────────────────────────────────────────────────────────────

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── Admin ────────────────────────────────────────────────────────────

    function setPolicy(Policy calldata _policy) external onlyOwner {
        _validatePolicy(_policy);
        policy = _policy;
        emit PolicyUpdated(_policy);
    }

    function setAgent(address _agent) external onlyOwner {
        if (_agent == address(0)) revert ZeroAddress();
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    // ── Views ────────────────────────────────────────────────────────────

    function executionLogCount() external view returns (uint256) { return executionLogs.length; }
    function vaultBalance()      external view returns (uint256) { return base.balanceOf(address(this)); }
    function riskBalance()       external view returns (uint256) { return risk.balanceOf(address(this)); }

    /// @notice Vault oracle mode identifier (for UI/indexer).
    function oracleMode() external pure returns (string memory) { return "trustless-pyth"; }

    // ── Internal — pricing (uses Pyth-normalised price, 8 dec) ──────────

    /// @dev price is the Pyth-normalised value (8 dec, same convention as SentriPriceFeed).
    function _quoteRiskToBase(uint256 riskAmount, uint256 price) internal view returns (uint256) {
        return (riskAmount * price * (10 ** baseDecimals))
             / ((10 ** 8) * (10 ** riskDecimals));
    }

    function _quoteBaseToRisk(uint256 baseAmount, uint256 price) internal view returns (uint256) {
        return (baseAmount * (10 ** 8) * (10 ** riskDecimals))
             / (price * (10 ** baseDecimals));
    }

    function _tvl(uint256 price) internal view returns (uint256) {
        return base.balanceOf(address(this))
             + _quoteRiskToBase(risk.balanceOf(address(this)), price);
    }

    // ── Internal — policy ────────────────────────────────────────────────

    function _enforceCooldown() internal view {
        if (
            lastExecutionTime != 0 &&
            block.timestamp < lastExecutionTime + policy.cooldownPeriod
        ) revert CooldownNotElapsed();
    }

    function _verifyTEE(string calldata signedResponse, bytes calldata teeSignature)
        internal
        view
        returns (address teeSigner, bytes32 responseHash)
    {
        responseHash  = keccak256(bytes(signedResponse));
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(bytes(signedResponse));
        teeSigner      = ECDSA.recover(digest, teeSignature);
        if (!agentNFT.isActiveAgentWithSigner(msg.sender, teeSigner)) revert InvalidTEESignature();
    }

    function _enforceRiskExposure(uint256 tvlAfter, uint256 price) internal view {
        uint256 riskValue    = _quoteRiskToBase(risk.balanceOf(address(this)), price);
        uint256 maxRiskValue = (tvlAfter * policy.maxAllocationBps) / 10_000;
        if (riskValue > maxRiskValue) revert AllocationExceeded();
    }

    function _enforceDrawdown(uint256 tvlAfter) internal view {
        if (highWaterMark == 0) return;
        uint256 maxDrawdown = (highWaterMark * policy.maxDrawdownBps) / 10_000;
        if (tvlAfter + maxDrawdown < highWaterMark) revert DrawdownBreached();
    }

    function _validatePolicy(Policy memory p) internal pure {
        if (
            p.maxAllocationBps      == 0  || p.maxAllocationBps      > 5000 ||
            p.maxDrawdownBps        == 0  || p.maxDrawdownBps         > 2000 ||
            p.rebalanceThresholdBps       > 5000 ||
            p.maxSlippageBps        == 0  || p.maxSlippageBps         > 500  ||
            p.cooldownPeriod        < 60  ||
            p.maxPriceStaleness     < 30  || p.maxPriceStaleness      > 600
        ) revert InvalidPolicy();
    }

    function _doSwap(address tokenIn, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256)
    {
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        return router.swapExactTokensForTokens(
            tokenIn,
            amountIn,
            minOut,
            address(this),
            block.timestamp + 300
        );
    }

    // ── Receive ETH (for Pyth fee refund path) ───────────────────────────
    receive() external payable {}
}
