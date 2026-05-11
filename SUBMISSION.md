Sentri — Verifiable Autonomous Treasury on 0G

Private strategy. Verifiable results. The agent proposes, the vault disposes.

Track 2 — Agentic Trading Arena (Verifiable Finance).


→ The problem

DAOs, protocols, and foundations hold Billions of stablecoin reserves on-chain, mostly idle. Manual deployment is slow and emotional. Trading bots are opaque and frontrunnable. Neither works for a treasury that needs both autonomy and auditability.


→ What we built

A multi-tenant treasury protocol where any DAO can deploy its own bounded vault (EIP-1167 aligned) with its own risk policy. A shared agent reasons about strategy privately inside a 0G TEE, and the vault enforces every cryptographic and economic check on-chain before any swap can fire. Every decision is TEE-signed. Every audit entry is on 0G Storage. The vault owner can pause, reconfigure, or hard-kill at any moment.


→ Why this is different

• The agent literally cannot break the policy. The vault rejects expired intents, replayed hashes, oversized exposure, drawdown breaches, slippage breaches, and unauthorised callers — on-chain, every execution.

• The AI is a defensive verifier, not a free trader. A deterministic vol-adjusted regime-aware matrix computes the safe action envelope. The LLM can confirm the recommendation or pick a strictly more cautious one. validateAgainstRecommendation() machine-checks this in the call path — risk-on overrides are rejected.

• Real assets, real venue. The mainnet stack uses USDC.E and W0G, with execution routed through the live Jaine V3 USDC.E/W0G pool via a hardened single-pool adapter. No mock liquidity in the production path.

• Decentralised oracle path. Each cycle requires Jaine V3 slot0() on-chain plus Pyth Network 0G/USD via Hermes (Pyth is 0G's day-one official oracle integration with 100+ institutional publishers). 2-of-2 quorum, spread-bounded, then keeper-pushed to SentriPriceFeed.


→ 0G integration (5 highlighted surfaces)

• 0G Chain — VaultFactory and TreasuryVault deployed natively on mainnet 16661.
• 0G Compute / Sealed Inference (TeeML) — processResponse fail-closed; vault verifies recovered TEE signer via EIP-191.
• 0G TEE / Private Sandbox — strategy reasoning sealed inside the provider path; chatID, signed payload, and recovered signer propagated to the audit trail.
• 0G Storage Log Layer (blob) — immutable canonical audit record uploaded per execution via MemData + Indexer.upload; merkle root and tx hash indexed in KV for tamper-evidence.
• 0G Storage KV — fast per-vault audit index + portfolio state; manifest enables full enriched recovery after agent restart.
• ERC-7857-aligned Agentic ID execution profile — gates executeStrategy on every vault; owner-revocable kill-switch across all vaults.
• Real DEX integration — JaineV3PoolAdapter, locked to the immutable Jaine pool address, validates every callback.

Persistent Memory is intentionally not used: every decision is stateless and replayable from on-chain plus storage data.


→ Official v2 stack live on 0G mainnet (chain 16661)

• VaultFactory: 0x9EE0c94c87FaDeB6dFb619B2C429eC05bc623cc7
• TreasuryVault impl: 0xf86013C68811047F6dEc98c4ED6601C80B720668
• AgentINFT: 0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951
• JaineV3PoolAdapter: 0xAdf55d5380f216F53f109B6B8341C9169BaeEBa4
• SentriPriceFeed: 0x1289638A90da7F24DB069168648819607A7377e6
• Demo vault (Aggressive): 0x20e8B2De8Ac2c8c5EE662Ea9986EC280FaebcA8E

The v2 demo vault has executed a TEE-signed strategy decision on mainnet. Primary reference transaction:

• 0x4b44c5063ca3b7f618a6dab5c20e840cb7d605e761162b6fbe847995df3d9ac4 — official v2 DemoVault execution: TEE-signed EmergencyDeleverage W0G → USDC.E via Jaine.

Recovered TEE signer on the current demo execution: 0x4386909Ef321651ab78298Ae454A05FF5d354118.


→ Risk presets at vault creation

• Conservative — 15% / 2% / 0.5% / 12 h. Foundation and endowment.
• Balanced — 30% / 5% / 1% / 30 min. Standard DAO treasury.
• Aggressive — 50% / 10% / 2% / 60 s. Active rebalancer.
• Custom — bounded by factory: ≤50% / ≤20% / ≤5% / ≥60 s.

(Format: max risk exposure / drawdown freeze / slippage cap / minimum action spacing.)


→ Stack

Solidity 0.8.24 + Foundry + OpenZeppelin v5. 105 tests passing across 6 suites. TypeScript agent runtime using @0glabs/0g-serving-broker (TeeML) and @0gfoundation/0g-ts-sdk (Storage). Next.js 14 + wagmi v2 + viem dashboard, editorial Bloomberg-meets-academic-paper design.

Pyth on-chain pull evidence path is implemented; trading still uses SentriPriceFeed enforcement. The owner has slippage-guarded deleverage recourse through emergencyDeleverageAndWithdraw(minBaseOut).


→ Roadmap (forward-looking — not live in v1)

v1.1 — hardening (weeks):

• Pyth on-chain pull integration — vault reads Pyth's deployed contract (0x2880ab15…7b43) directly via updatePriceFeeds, removing the keeper-pushed step.
• Jaine TWAP cross-check on slot0() once observation cardinality permits a 30-minute window — flash-trade-resistant manipulation guard.
• Complete canonical audit recovery from 0G Storage Log/blob + KV index: blob already written per execution; harden download path for full offline verification.
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
