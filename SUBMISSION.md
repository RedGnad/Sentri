Sentri — Verifiable Autonomous Treasury on 0G

Private strategy. Verifiable results. The agent proposes, the vault disposes.

Track 2 — Agentic Trading Arena (Verifiable Finance).


→ The problem

DAOs, protocols, and foundations hold ~$26B of stablecoin reserves on-chain, mostly idle. Manual deployment is slow and emotional. Trading bots are opaque and frontrunnable. Neither works for a treasury that needs both autonomy and auditability.


→ What we built

A multi-tenant treasury protocol where any DAO can deploy its own bounded vault (EIP-1167 clone) with its own risk policy. A shared agent reasons about strategy privately inside a 0G TEE, and the vault enforces every cryptographic and economic check on-chain before any swap can fire. Every decision is TEE-signed. Every audit entry is on 0G Storage. The vault owner can pause, reconfigure, or hard-kill at any moment.


→ Why this is different

• The agent literally cannot break the policy. The vault rejects expired intents, replayed hashes, oversized exposure, drawdown breaches, slippage breaches, and unauthorised callers — on-chain, every execution.

• The AI is a defensive verifier, not a free trader. A deterministic vol-adjusted regime-aware matrix computes the safe action envelope. The LLM can confirm the recommendation or pick a strictly more cautious one. validateAgainstRecommendation() machine-checks this in the call path — risk-on overrides are rejected.

• Real assets, real venue. The mainnet stack uses USDC.E and W0G, with execution routed through the live Jaine V3 USDC.E/W0G pool via a hardened single-pool adapter. No mock liquidity in the production path.

• Decentralised oracle path. Each cycle requires Jaine V3 slot0() on-chain plus Pyth Network 0G/USD via Hermes (Pyth is 0G's day-one official oracle integration with 100+ institutional publishers). 2-of-2 quorum, spread-bounded, then keeper-pushed to SentriPriceFeed.


→ 0G integration (5 of 6 components used)

• 0G Chain — VaultFactory and TreasuryVault deployed natively on mainnet 16661.
• 0G Compute / Sealed Inference — TeeML provider; processResponse fail-closed; vault verifies recovered TEE signer via EIP-191.
• 0G Storage KV — per-vault audit log + portfolio state, every entry binds intent hash, response hash, tx hash, and storage root.
• Agent INFT — gates executeStrategy on every vault; owner-revocable kill-switch across all vaults.
• Real DEX integration — JaineV3PoolAdapter, locked to the immutable Jaine pool address, validates every callback.

The 6th component (Persistent Memory) is intentionally not used: every decision is stateless and replayable from on-chain plus storage data.


→ Live on 0G mainnet (chain 16661)

• VaultFactory: 0x1794AADef202E0f39494D27491752B06c0CC26BC
• TreasuryVault impl: 0x539ad624e9Be34db7369C6ee0fB22A6dF01C7BEE
• AgentINFT: 0x83C375F3808efAB339276E98C20dddfa69Af3659
• JaineV3PoolAdapter: 0x27647dB3F250EF843BAa7d06F50Bb2648F34c1E2
• SentriPriceFeed: 0x13a37CC2D39B9615A7e0B773f869AD3998dba0b6
• Demo vault (Aggressive): 0x87dA9a9A5fC6aA33a3379C026482704c41ECc676

The demo vault has executed multiple TEE-signed strategy decisions on mainnet. Reference transactions:

• 0x30a2d51a2802fefdea4c5135dc3ea2f33fa4218ed0b360f9cc4610aa7db3f675 — first mainnet rehearsal: TEE-signed EmergencyDeleverage W0G → USDC.E via Jaine.
• 0x5bf6ab1b5bb8f200f6b1a076ca10bff131d2b539eef00e64c84af86e361739c4 — Strategy v2 cycle: regime classified up_tight, target 28% W0G for Aggressive, LLM confirmed, vault swapped USDC.E → W0G.

Recovered TEE signer on every execution: 0xA46EA4FC5889AD35A1487e1Ed04dCcfa872146B9.


→ Risk presets at vault creation

• Conservative — 15% / 2% / 0.5% / 12 h. Foundation and endowment.
• Balanced — 30% / 5% / 1% / 30 min. Standard DAO treasury.
• Aggressive — 50% / 10% / 2% / 60 s. Active rebalancer.
• Custom — bounded by factory: ≤50% / ≤20% / ≤5% / ≥60 s.

(Format: max risk exposure / drawdown freeze / slippage cap / minimum action spacing.)


→ Stack

Solidity 0.8.24 + Foundry + OpenZeppelin v5. 86 tests passing across 6 suites. TypeScript agent runtime using @0glabs/0g-serving-broker (TeeML) and @0gfoundation/0g-ts-sdk (Storage). Next.js 14 + wagmi v2 + viem dashboard, editorial Bloomberg-meets-academic-paper design.


→ Roadmap (forward-looking — not live in v1)

v1.1 — hardening (weeks):

• Pyth on-chain pull integration — vault reads Pyth's deployed contract (0x2880ab15…7b43) directly via updatePriceFeeds, removing the keeper-pushed step.
• Jaine TWAP cross-check on slot0() once observation cardinality permits a 30-minute window — flash-trade-resistant manipulation guard.
• Move audit trail from 0G Storage KV to Log Layer for append-only semantics; KV stays as the fast UI index.
• Third-party security audit.

v2 — productive treasury (months):

• Yield-bearing base asset (sUSDS / sUSDe / sFRAX / 4626-compatible) — idle capital earns the staking rate while waiting for productive deployment, matching 2026 DAO treasury norms.
• Multi-asset risk side: vol-weighted basket (W0G + ETH + tokenized RWAs) instead of one risk asset per vault.
• RWA exposure as a third class once major issuers (Ondo, Maple, Backed) ship on 0G.
• Operator INFTs — open the agent role to multiple verified operators. Each publishes its decision matrix as an INFT; vault owners pick an operator and can rotate without redeploying.

v3 — Sentri as a treasury primitive (vision):

• Composable risk envelopes: any treasury allocation across lending, perps, LP — bounded by the same Sentri policy.
• Cross-chain coordination via 0G as the compute and audit layer; vault funds on any chain, decisions and proofs on 0G.
• Treasury platform integrations (Karpatkey, Llama Risk, Steakhouse) — Sentri vaults as managed accounts inside existing DAO tooling.
• Public on-chain operator track records: every operator INFT accrues a permanent performance record (PnL, drawdown realised vs bound, frequency of defensive overrides).

The thesis: the treasury problem is not about clever trading. It is about bounded productive capital with cryptographic recourse. Every roadmap item makes that envelope more useful or more verifiable — never the agent more powerful relative to the vault.


→ Try it

Repo: https://github.com/RedGnad/Sentri

Connect a wallet on 0G mainnet, deploy a vault from the wizard, optionally seed it with USDC.E, and watch the agent operate within the policy you set.

Galileo testnet rehearsal contracts (chain 16602) are also deployed for deterministic full-loop demos against MockUSDC + MockWETH liquidity. Full address list in the repository README.


→ One-line summary

Sentri is not an AI trader. It is a verifiable treasury vault where AI can propose, but only cryptographic identity, on-chain policy, oracle freshness, replay protection, and owner controls decide whether capital can move.
