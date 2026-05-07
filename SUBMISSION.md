SENTRI — VERIFIABLE AUTONOMOUS TREASURY ON 0G

A multi-tenant treasury protocol where any DAO, foundation, or protocol can deploy its own bounded vault. A shared agent reasons about strategy privately through 0G's verifiable TEE provider path, and the vault enforces the risk envelope on-chain. Private strategy. Verifiable results.

Submitted to: 0G APAC Hackathon — Track 2 (Agentic Trading Arena / Verifiable Finance).


THE PROBLEM

Roughly 26 billion dollars of stablecoin reserves sit on-chain in DAO and protocol treasuries, mostly idle. Putting that capital to work today means choosing between manual deployment (slow, emotional, expensive in attention) or opaque trading bots (public strategies that get frontrun, no recourse when they misbehave). Neither is acceptable for a treasury that needs both autonomy and auditability.


THE ANSWER

Sentri is a treasury infrastructure where every user owns their own vault contract, deployed as an EIP-1167 clone with their own risk policy. A shared agent operates across all vaults: it requests a strategy decision through a 0G verifiable TEE provider path so the reasoning stays private, the vault enforces the on-chain policy so the agent literally cannot break the bounds, every decision is cryptographically attested, the audit trail is verifiable on 0G Storage, and the vault owner can pause, reconfigure, or hard-kill at any moment.

The mantra: the agent proposes, the vault disposes.


LIVE ON 0G MAINNET

Chain ID 16661. Real assets: USDC.E (bridged USDC) as the base stable, W0G as the risk asset, Jaine USDC.E/W0G V3 pool as the execution venue.

VaultFactory (entry point): 0x1794AADef202E0f39494D27491752B06c0CC26BC
TreasuryVault implementation: 0x539ad624e9Be34db7369C6ee0fB22A6dF01C7BEE
AgentINFT: 0x83C375F3808efAB339276E98C20dddfa69Af3659
JaineV3PoolAdapter: 0x27647dB3F250EF843BAa7d06F50Bb2648F34c1E2
SentriPriceFeed: 0x13a37CC2D39B9615A7e0B773f869AD3998dba0b6
Demo vault (Aggressive preset): 0x87dA9a9A5fC6aA33a3379C026482704c41ECc676

The demo vault has executed multiple TEE-signed strategy decisions on mainnet, each one swapping through the real Jaine pool. Reference transactions:

0x30a2d51a2802fefdea4c5135dc3ea2f33fa4218ed0b360f9cc4610aa7db3f675 — first mainnet rehearsal: a TEE-signed EmergencyDeleverage swapped W0G into USDC.E through the hardened Jaine adapter.

0x5bf6ab1b5bb8f200f6b1a076ca10bff131d2b539eef00e64c84af86e361739c4 — Strategy v2 cycle: the deterministic engine classified the regime as up_tight (24h positive, oracle spread tight), targeted 28% W0G for the Aggressive preset, the LLM confirmed the matrix recommendation, and the vault swapped USDC.E into W0G to bring the position to target. The Strategy v2 loop has since produced more executions including a defensive trim when the regime shifted; full audit is on-chain via the dashboard's audit tab and on chainscan.0g.ai.

Recovered TEE signer on every execution: 0xA46EA4FC5889AD35A1487e1Ed04dCcfa872146B9.


HOW 0G SHOWS UP IN THE PRODUCT (5 COMPONENTS USED)

0G Chain. The VaultFactory and TreasuryVault contracts run natively on 0G mainnet. The vault enforces every cryptographic and economic check on-chain before allowing a swap.

0G Compute (Sealed Inference / TeeML). Each strategy decision is computed through a verifiable TeeML provider. The agent fails closed unless processResponse returns true; the vault then checks the recovered TEE signer against the AgentINFT-bound expected signer before any swap fires. The chat payload is signed by the TEE provider and verified on-chain via EIP-191.

0G Storage KV. Every successful execution writes an audit entry to 0G Storage KV under a per-vault namespace. The entry binds the verified model response, the reconstructed execution intent, the on-chain transaction hash, the TEE signature, and the storage tx and root hash. Per-vault portfolio state lives in a separate KV stream.

Agent INFT. AgentINFT.sol gates executeStrategy on every vault. The vault checks both that msg.sender is the registered agent and that the agent holds an active INFT bound to the recovered TEE signer. Owner can revoke the INFT to halt the agent across all vaults at once.

Real DEX integration. The Jaine V3 USDC.E/W0G pool is the execution venue. JaineV3PoolAdapter is a hardened single-pool adapter: it exposes the same swap surface the vault uses on Galileo, accepts the Jaine pool's V3-style callback only from the immutable pool address, validates the path, and caps amountToPay against amountInMax.

The 6th 0G component (Persistent Memory) is intentionally not used. Every strategy decision is stateless and replayable from on-chain plus storage data, so adding persistent memory would create new trust assumptions without product benefit.


HOW A CYCLE ACTUALLY WORKS

Every cycle (interval is configurable per deployment), the agent runs the following sequence.

1. Fetches the market price. For the W0G mainnet path it uses Jaine V3 slot0 on-chain plus Pyth Network 0G/USD via the public Hermes endpoint, with a 2-of-2 quorum and a spread bound between the two sources. Pyth is 0G's official mainnet oracle integration with 100+ institutional publishers.

2. Pushes the median price to SentriPriceFeed on-chain so the vault has a fresh reference.

3. Discovers all vaults from the factory and iterates each one.

4. For each vault: reads state, classifies the regime from drawdown, 24h change, and oracle spread, and computes a deterministic recommendation against a documented vol-adjusted regime-aware matrix. Hold band is plus or minus three percentage points around the regime target.

5. Sends the inputs plus the recommendation to the TeeML provider. The model confirms the recommendation or proposes a strictly more cautious decision.

6. The agent runs validateAgainstRecommendation on the model output. Any attempt to exceed a Rebalance buy, under-trim a defensive recommendation, or propose risk-on under crash or drawdown_breach regimes is rejected and the cycle is skipped with a logged reason. The "AI as defensive verifier" claim is machine-checked, not just doctrinal.

7. If the decision survives, the agent submits executeStrategy with the canonical intent hash, the signed chat payload, the TEE signature, the attestation hash, and a deadline. The vault performs every on-chain check before the swap can fire.

8. On success, the agent writes the audit entry and the portfolio state to 0G Storage KV.

The strategy itself is fully reproducible off-chain by anyone with the same inputs. The TEE binds the resulting decision to a cryptographic identity; the vault enforces the bounds.


RISK ENVELOPE (WHAT THE VAULT ENFORCES ON EVERY EXECUTION)

Caller is the registered agent.
Agent holds an active Agent INFT bound to the recovered TEE signer.
Provider chat payload is signed by that TEE signer (EIP-191).
Intent freshness: each execution carries a deadline; expired intents revert.
Replay protection: intent hash and response hash are single-use.
Cooldown elapsed since the last execution.
Post-trade risk-asset exposure within the per-vault cap.
Drawdown from the high-water mark within the per-vault cap.
Oracle price freshness within the per-vault cap.
Swap output respects the slippage bound vs the oracle price.
Vault not paused or killed.
Re-entrancy guarded.

Owner recourse, always available: pause to freeze activity reversibly, emergencyWithdraw to return all assets immediately, emergencyDeleverageAndWithdraw to attempt a base-asset exit with slippage protection.


RISK PRESETS AT VAULT CREATION

Conservative — 15% max risk exposure, 2% drawdown freeze, 0.5% slippage cap, 12 hour minimum action spacing. Foundation and endowment posture.

Balanced — 30% max risk exposure, 5% drawdown freeze, 1% slippage cap, 30 minute minimum action spacing. Standard DAO treasury.

Aggressive — 50% max risk exposure, 10% drawdown freeze, 2% slippage cap, 60 second minimum action spacing. Active rebalancer with higher cadence.

Custom — bounded by factory validation: max 50% risk exposure, max 20% drawdown, max 5% slippage, minimum 60 second action spacing.

Owner can update the policy any time within the validation bounds.


WHAT IS INTENTIONALLY OUT OF SCOPE

Active short-term trading: Sentri rebalances and risk-manages, it does not chase short-term alpha. The interesting privacy story is which constraints the agent enforces in private, not which trades it places.

Multiple risk assets per vault: one base stable + one risk asset per vault.

Multi-chain: v1 targets 0G mainnet for review and Galileo for rehearsal. Cross-chain coordination is out of scope.

Persistent memory across iterations: stateless by design — auditability first.

Operator marketplace: single shared verified agent, custom vault policies. The differentiation is one verified operator, your vault, your policy — not a market of unverified operators.


STACK

Solidity 0.8.24, Foundry, OpenZeppelin v5 (and v5.6.1 upgradeable). 86 unit and integration tests passing across 6 suites.

TypeScript agent runtime using @0glabs/0g-serving-broker for TeeML inference and @0gfoundation/0g-ts-sdk for 0G Storage.

Next.js 14 App Router dashboard with wagmi v2 and viem. Editorial Bloomberg-meets-academic-paper design language: terminal-grade information density, editorial typography (Instrument Serif, Inter Tight, JetBrains Mono).


TRY IT

Repo: https://github.com/RedGnad/Sentri

Dashboard: hosted at the project URL. Connect a wallet on 0G mainnet, deploy a vault from the wizard, optionally seed it with USDC.E, and watch the agent operate within the policy you set.

Deployer / agent wallet: 0x981F6E0Ea94f45fDB8ee7680DC862212E3C720e0 — registered as agent on the factory, holder of the Agent INFT, and registered keeper on SentriPriceFeed.

Galileo testnet rehearsal contracts (chain ID 16602) are also deployed for deterministic full-loop demos against MockUSDC and MockWETH liquidity, full address list in the README.


ONE-LINE SUMMARY FOR THE BUSY READER

Sentri is not an AI trader. It is a verifiable treasury vault where AI can propose, but only cryptographic identity, on-chain policy, oracle freshness, replay protection, and owner controls decide whether capital can move.
