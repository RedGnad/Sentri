# Sentri
## AI agents are getting wallets. Sentri keeps them on a leash. 

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/solidity-0.8.24-363636.svg)](./contracts/foundry.toml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-43853d.svg)](./package.json)
[![Tests](https://img.shields.io/badge/forge%20tests-130%20passing-brightgreen.svg)](./contracts/test)
[![0G Mainnet](https://img.shields.io/badge/0G-mainnet%2016661-FFB300.svg)](https://chainscan.0g.ai/address/0x8e129b97df1b513099329aC50B4774f8BeE1d538)

**Verified AI treasury execution with hard on-chain limits, for stablecoin reserves on 0G.**
Private strategy, verifiable results. The agent proposes, the vault disposes.

Sentri is a multi-tenant treasury protocol. Anyone can deploy their own bounded vault from a public factory, with their own risk policy. A shared agent operates across every vault: it requests strategy through a verifiable 0G Sealed Inference TEE provider path, and the vault enforces every cryptographic and economic check on-chain before any swap can fire. The vault owner can pause, reconfigure, or hard-kill at any moment.

> **🔌 Build on Sentri:** the verifiable execution layer is now a standalone primitive any 0G agent can plug into — one call gives every decision a tamper-proof, verifiable on-chain receipt. Live on mainnet. **→ [docs/execution-registry.md](./docs/execution-registry.md)**

```
┌──────────────┐   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐   ┌──────────────┐
│ Market data  │ → │ Sealed        │ → │ Per-vault     │ → │ On-chain      │ → │ 0G Storage   │
│ risk/base    │   │ Inference TEE │   │ policy check  │   │ swap          │   │ per-vault    │
└──────────────┘   └───────────────┘   └───────────────┘   └───────────────┘   │ audit trail  │
                       private              public              real           └──────────────┘
                                                                                  verifiable
```

---

## Judge summary

Demo video: https://www.youtube.com/watch?v=8eVnhSPZd_4

Demo live: https://sentri-fi.xyz


Mainnet deployment:

• VaultFactory: 0x8e129b97df1b513099329aC50B4774f8BeE1d538

• TreasuryVault impl: 0xe8a843715c776A9d44943DF9CD246C6df1610437

• AgentINFT: 0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951

• JaineV3PoolAdapter: 0xAdf55d5380f216F53f109B6B8341C9169BaeEBa4

• SentriPriceFeed: 0x1289638A90da7F24DB069168648819607A7377e6

• Demo vault (Aggressive): 0x79aBe91dE33c3D27812c4CDafd8b67A7efFcf710


| Question | Answer |
|---|---|
| What is Sentri? | A policy-first autonomous treasury vault on 0G. |
| Is it live on mainnet? | Yes, deployed on 0G mainnet `16661`. |
| Does it move real assets? | Yes, `USDC.E/W0G` through Jaine. |
| What 0G components are used? | 5 0G components: Chain (deployed contracts), Compute/Sealed Inference (TEE provider path), Storage Log (immutable audit blobs), Storage KV (per-vault state index), AgentINFT (on-chain agent identity + signer binding). Execution venue: Jaine V3 on 0G mainnet. |
| Is the AI trusted blindly? | No, the vault enforces signer, replay, deadline, exposure, drawdown, slippage, oracle freshness, pause and kill. |
| Can judges verify it? | Yes, public dashboard, chainscan links, execution txs, storage root hashes, and storage tx links when available. |
| How does a user start? | Email, Google, Discord or X sign-in, no seed phrase, no native OG — the first vault deploys and takes its first deposit in one gas-sponsored transaction. Sponsorship covers gas only; the deposit is the user's own `USDC.E`. Feature-flagged. |

---

## Features

- **Multi-tenant factory.** Anyone deploys their own `TreasuryVault` clone (EIP-1167 minimal proxy) with their own risk policy. Per-vault registry, per-vault audit trail, per-vault kill controls.
- **AI as defensive verifier.** A deterministic vol-adjusted regime-aware matrix computes the safe action envelope. The TeeML LLM may confirm the recommendation or pick a strictly more cautious one — never more aggressive. `validateAgainstRecommendation()` machine-checks this in the call path.
- **Spread-bounded oracle path.** Each cycle requires Jaine V3 `slot0()` on-chain plus Pyth Network `0G/USD` via Hermes. 2-of-2 quorum, spread-bounded, then keeper-pushed to `SentriPriceFeed`.
- **Real assets, real venue.** The mainnet stack uses `USDC.E` and `W0G`, with execution routed through the live Jaine V3 `USDC.E/W0G` pool via a hardened single-pool adapter.
- **Owner recourse always available.** `pause` to freeze activity reversibly, `emergencyWithdraw` to return all assets immediately, `emergencyDeleverageAndWithdraw(minBaseOut)` to attempt a base-asset exit with slippage protection.
- **Gasless, seedless onboarding.** Email, Google, Discord or X sign-in creates an embedded wallet and an ERC-4337 Safe smart account; the first vault is deployed and its first deposit made in a single paymaster-sponsored UserOp, with zero native OG required. The paymaster sponsors gas only — the deposit is the user's own `USDC.E`, pulled from the smart account in the same tx. Feature-flagged, falls back to standard external-wallet connect.

## Onboarding — gasless and seedless

Most treasury tools assume the user already has a wallet, a seed phrase, and native gas. Sentri removes the wallet, the seed, and the gas barrier. The user signs in with email, Google, Discord, or X, an embedded wallet is created for them (no seed phrase to store), and a Safe smart account (ERC-4337, EntryPoint v0.7) is deployed on first use. Creating the first vault is a single `UserOperation` that batches the ERC-20 `approve` and the factory `createVaultAndDeposit`; a `VerifyingPaymaster` pays the **gas**, so the user signs once and needs **zero native OG**.

To be exact about what is and isn't sponsored: the paymaster sponsors **gas only**. The deposit itself is the user's own `USDC.E`, pulled from their smart account in the same transaction — Sentri does not fund the treasury, it removes the gas barrier to opening and funding one. A user holding `USDC.E` but no `OG` can still deploy a vault and make its first deposit in one click.

| Step | Mechanism |
|---|---|
| Sign in | Email, Google, Discord, or X (Privy), no seed phrase |
| Wallet | Embedded signer → Safe smart account (ERC-4337, EntryPoint v0.7) |
| Gas | Sponsored by a `VerifyingPaymaster` restricted to an on-chain target allowlist (factory + base token); batched calls are decoded so only Sentri actions are paid for |
| Funds | The user's own `USDC.E`, pulled from their smart account — **not** sponsored |
| First action | One batched UserOp: `approve` + `createVaultAndDeposit` → vault deployed, first deposit made, no gas paid by the user |

Verified end-to-end on 0G mainnet: a sign-in created a smart account that deployed a vault and made its first `USDC.E` deposit in a single transaction while holding zero native OG. The flow is feature-flagged behind `NEXT_PUBLIC_PRIVY_APP_ID`; without it the dashboard uses the standard external-wallet (RainbowKit / wagmi) connect.

Why it matters: autonomous treasury management is the hardest use case to trust and to onboard. Making it the easiest to *start* — no seed, no gas, with every risk bound still enforced on-chain — is the point.

## 0G integration

Sentri uses 5 highlighted 0G surfaces + 1 real 0G mainnet ecosystem venue.

| Layer | Usage |
|---|---|
| 0G Chain | `VaultFactory` and `TreasuryVault` deployed natively on mainnet `16661`. |
| 0G Compute / Sealed Inference (TeeML) | `processResponse()` fail-closed, then EIP-191 verification of the recovered TEE signer on-chain. |
| 0G TEE / Private Sandbox | Strategy reasoning runs inside the sealed provider path; `chatID`, signed payload, and recovered signer are propagated to the audit trail for verifiable review. |
| 0G Storage Log Layer (blob) | Immutable canonical audit record uploaded per execution; root hash and optional storage tx metadata are mirrored into the per-vault KV/cache index for tamper-evidence. |
| 0G Storage KV | Fast per-vault audit index and portfolio state, namespaced by vault address; used as recovery layer after agent restart. |
| Agent INFT | ERC-7857-aligned Agentic ID execution profile: gates `executeStrategy` on every vault; owner-revocable kill-switch across all vaults at once. The AgentINFT is a vault-execution gating token — it does not implement `iTransferFrom` by design. The agent's cryptographic identity binds to a registered signer, not to a marketplace transfer flow; `authorizeUsage`, `rotateSigner`, and `isActiveAgentWithSigner` are the operative ERC-7857 surfaces. |
| 0G ecosystem venue: Jaine | Real `USDC.E/W0G` execution through `JaineV3PoolAdapter`, locked to the immutable Jaine pool address. |

Persistent Memory is intentionally not used: every strategy decision is stateless and replayable from on-chain plus storage data.

---

## Risk presets

| Preset | Max risk exposure | Drawdown freeze | Slippage cap | Min action spacing | Use case |
|---|---|---|---|---|---|
| Conservative | 15% | 2% | 0.5% | 12 h | Foundation / endowment |
| Balanced | 30% | 5% | 1% | 30 min | Standard DAO treasury |
| Aggressive | 50% | 10% | 2% | 60 s | Active rebalancer |
| Custom | ≤ 50% | ≤ 20% | ≤ 5% | ≥ 60 s | Bounded by factory validation |

Custom policies are validated on-chain at vault creation; out-of-range values revert with `CustomPolicyOutOfRange`. Owners can update the policy any time within these bounds.

---

## Deployed contracts

### 0G Mainnet official v2 stack (chain `16661`)

| Contract | Address |
|---|---|
| `VaultFactory` (entry point) | [`0x8e129b97df1b513099329aC50B4774f8BeE1d538`](https://chainscan.0g.ai/address/0x8e129b97df1b513099329aC50B4774f8BeE1d538) |
| `TreasuryVault` impl | [`0xe8a843715c776A9d44943DF9CD246C6df1610437`](https://chainscan.0g.ai/address/0xe8a843715c776A9d44943DF9CD246C6df1610437) |
| `AgentINFT` | [`0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951`](https://chainscan.0g.ai/address/0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951) |
| `JaineV3PoolAdapter` | [`0xAdf55d5380f216F53f109B6B8341C9169BaeEBa4`](https://chainscan.0g.ai/address/0xAdf55d5380f216F53f109B6B8341C9169BaeEBa4) |
| Jaine `USDC.E/W0G` pool, 0.3% | [`0xa9e824Eddb9677fB2189AB9c439238A83695C091`](https://chainscan.0g.ai/address/0xa9e824Eddb9677fB2189AB9c439238A83695C091) |
| `SentriPriceFeed` | [`0x1289638A90da7F24DB069168648819607A7377e6`](https://chainscan.0g.ai/address/0x1289638A90da7F24DB069168648819607A7377e6) |
| `USDC.E` | [`0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E`](https://chainscan.0g.ai/address/0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E) |
| `W0G` | [`0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c`](https://chainscan.0g.ai/address/0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c) |
| Demo vault (Aggressive preset) | [`0x79aBe91dE33c3D27812c4CDafd8b67A7efFcf710`](https://chainscan.0g.ai/address/0x79aBe91dE33c3D27812c4CDafd8b67A7efFcf710) |
| Primary v2 execution tx — `EmergencyDeleverage` (`W0G → USDC.E`) | [`0x4b44c506…9ac4`](https://chainscan.0g.ai/tx/0x4b44c5063ca3b7f618a6dab5c20e840cb7d605e761162b6fbe847995df3d9ac4) |

`USDC.E` is bridged USDC on 0G mainnet, not native Circle USDC. Recovered TEE signer on the current demo execution: `0x4386909Ef321651ab78298Ae454A05FF5d354118`.

### Trustless Oracle Vault: Advanced Tier (live on mainnet, verified execution)

An advanced execution tier that replaces the keeper-pushed price step with a **Pyth pull oracle verified on-chain in the same transaction as the swap**. **Live on 0G mainnet with a verified `executeStrategyWithPyth` tx** (see canonical execution below). **Opt-in per vault**, the Standard keeper path remains the default for vaults too small to amortize the Pyth update fee.

For one-page protocol references see [`docs/oracle-proof.md`](./docs/oracle-proof.md) (oracle path verification) and [`docs/tee-trust-boundary.md`](./docs/tee-trust-boundary.md) (TEE trust boundary).

| Contract / tx | Address |
|---|---|
| `VaultFactoryV2` | [`0xd5660Ef30460baa74950774DA55b515bdce5259F`](https://chainscan.0g.ai/address/0xd5660Ef30460baa74950774DA55b515bdce5259F) |
| `TreasuryVaultTrustlessOracle` impl | [`0x07b2b6f4f8185fBBa075Bb07F43bE9Fc05787eA7`](https://chainscan.0g.ai/address/0x07b2b6f4f8185fBBa075Bb07F43bE9Fc05787eA7) |
| Reference V2 vault (Balanced preset) | [`0x7B6ee7D1145A59D725De47c59c4576e99B2cF0FC`](https://chainscan.0g.ai/address/0x7B6ee7D1145A59D725De47c59c4576e99B2cF0FC) |
| Pyth oracle (0G mainnet) | [`0x2880aB…7B43`](https://chainscan.0g.ai/address/0x2880aB155794e7179c9eE2e38200202908C17B43) |
| Pyth feed `Crypto.0G/USD` | `0xfa9e8d45…ea3070` |
| `createVault` tx | [`0x81cff80a…f4fcb8`](https://chainscan.0g.ai/tx/0x81cff80ace50a2cfb8051c015505667c5df7812e754a0c4b56a6fdf410f4fcb8) |
| `setAuthorizedFactory` tx (owner) | [`0x7c018f9f…87a3d55`](https://chainscan.0g.ai/tx/0x7c018f9fbd7050a7369267be0272c7a31bf9a9bf7cb16eea5c224446887a3d55) |

**Standard vs Advanced.** Standard (default, live): price keeper-pushed to `SentriPriceFeed` (Jaine `slot0()` + Pyth Hermes, 2-of-2 quorum off-chain). Advanced (live, opt-in): each `executeStrategyWithPyth()` carries a signed Pyth update verified on-chain in the same tx, the keeper-pushed step is removed from the execution path, and the verified price drives `minOut`, exposure, drawdown and TVL, under `pythMaxAge = 60s` and `pythMaxConfBps = 200`.

**Canonical execution (verified on mainnet).** `executeStrategyWithPyth` tx [`0x45ab1a82…7317fa`](https://chainscan.0g.ai/tx/0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa) — Rebalance `0.3186 USDC.E → 0.7468 W0G`, Pyth `0G/USD` verified on-chain in the same tx (price 0.42406745, 22 bps conf, 9 s fresh), `executionLogCount` 0 → 1.

**Exact scope (no overclaiming).** Pyth price is pull-verified on-chain per execution. The TEE binding is signer-based (ECDSA recovery against the AgentINFT-bound signer); the contract does not parse the full TEE attestation report, and there is **no on-chain Jaine/Pyth cross-check yet**.

Verify it yourself (read-only, no key) from a fresh clone:

```bash
pnpm install
pnpm --filter @steward/sdk verify:summary -- --tx 0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa
```

Output ends with `VERDICT: PASS`. This wraps `verify:trustless-execution` (Pyth + TEE + policy + explorer) and prints the off-chain 0G Storage anchors for the audit blob. Supplementary: `pnpm --filter @steward/sdk verify:trustless-canary` verifies the deploy + factory authorization separately.

### 0G Galileo Testnet (chain `16602`)

| Contract | Address |
|---|---|
| `VaultFactory` (entry point) | [`0x8a94F377De5450269e2035C8fAE31dE1E181F10e`](https://chainscan-galileo.0g.ai/address/0x8a94F377De5450269e2035C8fAE31dE1E181F10e) |
| `TreasuryVault` impl | [`0x2A33268CbB4a5639063331Db94FD94a8426765C0`](https://chainscan-galileo.0g.ai/address/0x2A33268CbB4a5639063331Db94FD94a8426765C0) |
| `AgentINFT` | [`0x1181A8670d5CA9597D60fEf2A571a14C58F33020`](https://chainscan-galileo.0g.ai/address/0x1181A8670d5CA9597D60fEf2A571a14C58F33020) |
| `SentriSwapRouter` | [`0xD58b37C4d838aad5E0734ba3F0d34DFA34186d7C`](https://chainscan-galileo.0g.ai/address/0xD58b37C4d838aad5E0734ba3F0d34DFA34186d7C) |
| `SentriPair` | [`0x0BeC7F13a4E9DAc95954EcdF3FF2DABd8279700f`](https://chainscan-galileo.0g.ai/address/0x0BeC7F13a4E9DAc95954EcdF3FF2DABd8279700f) |
| `SentriPriceFeed` | [`0x0e75243d34E904Ab925064c8297b36484Ce2aB5E`](https://chainscan-galileo.0g.ai/address/0x0e75243d34E904Ab925064c8297b36484Ce2aB5E) |
| `MockUSDC` | [`0xAcd0cc301eB160aA8C19B02a9Fac9a1967A69bE3`](https://chainscan-galileo.0g.ai/address/0xAcd0cc301eB160aA8C19B02a9Fac9a1967A69bE3) |
| `MockWETH` | [`0x246e6080D736A217C151C3b88890C08e2C249d5E`](https://chainscan-galileo.0g.ai/address/0x246e6080D736A217C151C3b88890C08e2C249d5E) |
| Demo vault (Aggressive preset) | [`0x5Aa3a7083915F6213238fc8c7461be969d5504e2`](https://chainscan-galileo.0g.ai/address/0x5Aa3a7083915F6213238fc8c7461be969d5504e2) |

---

## Quickstart

### Prerequisites

- Node ≥ 20, pnpm ≥ 9
- [Foundry](https://book.getfoundry.sh/) for the contracts
- A wallet with a small amount of native OG ([Galileo faucet](https://faucet.0g.ai))

### Install

```bash
pnpm install
```

### Run the dashboard locally

```bash
cp apps/web/.env.example apps/web/.env.local   # set AGENT_URL to your agent server URL
pnpm dev
```

Visit `http://localhost:3000`. Connect a wallet on 0G Galileo or mainnet, deploy a vault from the wizard, optionally seed it with USDC, and watch the agent operate within the policy you set.

### Run the agent

```bash
cp packages/sdk/.env.example packages/sdk/.env  # fill PRIVATE_KEY
pnpm --filter @steward/sdk run setup-broker     # one-shot 0G compute broker registration
pnpm --filter @steward/sdk run server           # long-running HTTP server (/healthz, /vaults, /vault/:addr/state, /vault/:addr/audit)
# OR
pnpm agent                                       # standalone CLI loop
```

The agent wallet must be (1) registered as `agent` on the `VaultFactory`, (2) holding an active Agent INFT, and (3) a registered keeper on `SentriPriceFeed`.

### Run the test suite

```bash
cd contracts && forge test
```

136 tests passing across 10 suites: `TreasuryVault` (30), `AgentINFT` (30), `VaultFactory` (21), `TrustlessOracle` (15), `MultiVault` (13), `SentriPair` (8), `PythPriceAdapter` (7), `TrustlessOracleKillSwitch` (6), `JaineV3PoolAdapter` (5), `StandardVaultUnchanged` (1). See [`docs/architecture.md`](./docs/architecture.md#test-coverage) for coverage detail.

---

## Architecture

The protocol has three layers: a Solidity contract suite (factory + per-user vaults + Jaine adapter + agent INFT + price feed), a TypeScript agent runtime that runs the cycle (price push → vault discovery → TEE inference → policy-checked execution → 0G Storage write), and a Next.js dashboard that exposes per-vault overview, audit, policy and emergency controls.

For the full per-file breakdown, agent cycle steps, regime matrix, defensive-verifier contract, and trust boundary detail, see [`docs/architecture.md`](./docs/architecture.md).

---

## Trust boundary (summary)

Sentri does not oversell what's verified on-chain.

The chain verifies: registered agent caller, active Agent INFT bound to the recovered TEE signer, EIP-191 signature on the provider chat payload, intent freshness (deadline) and replay protection (single-use intent and response hashes), cooldown, post-trade exposure cap, drawdown bound, oracle freshness, slippage bound, pause/kill state, and re-entrancy.

The chain does **not** verify the full TEE attestation report, does not parse the model JSON, and does not compute the strategy itself. The agent decides; the contract enforces bounds. A malicious agent inside the bounded envelope can still pick the worst-of-allowed actions, but cannot exceed risk exposure, drawdown, slippage, or cooldown.

Standard vaults use `SentriPriceFeed` enforcement: on mainnet the agent fetches Jaine `slot0()` on-chain plus Pyth `0G/USD` via Hermes, both must succeed and agree within the spread bound, and the median is keeper-pushed to `SentriPriceFeed`. Advanced opt-in vaults use `executeStrategyWithPyth` with a Pyth pull update verified on-chain in the same transaction as the swap (see [`docs/oracle-proof.md`](./docs/oracle-proof.md), canonical tx `0x45ab…7317fa`). CoinGecko is opportunistic for 24h change only and never gates trading.

For the complete enumeration, see [`docs/architecture.md#trust-boundary`](./docs/architecture.md#trust-boundary).

---

## Roadmap

This is a forward-looking section.

**Next hardening (weeks)**

- **Extend the standard keeper runtime to auto-cycle Advanced vaults** — each Advanced execution is currently triggered on-demand per vault. Surface per-vault tier selection in the deploy UI. (Pyth pull integration itself is already live on mainnet for the Advanced tier — see "Trustless Oracle Vault — Advanced Tier" above; canonical tx `0x45ab…7317fa`.)
- Jaine TWAP cross-check on `slot0()` once `observe()` cardinality permits a 30-minute window — flash-trade-resistant manipulation guard.
- Canonical audit recovery from 0G Storage Log/blob + KV index is live: pre-execution blobs are uploaded before each swap, root hashes are bound to the on-chain intent hash, and `audit-recovery.ts` implements a three-tier fallback (blob → KV index → on-chain entry) that survives node and KV outages. Next hardening: full generic offline verification CLI and restart-proof indexing without requiring demo recovery records.
- Third-party security audit.

**Future productive treasury extensions (months)**

- Yield-bearing base asset (`sUSDS` / `sUSDe` / `sFRAX` / any 4626-compatible) — idle capital earns the staking rate.
- Multi-asset risk side: vol-weighted basket (W0G + ETH + tokenized RWAs) instead of one risk asset per vault.
- RWA exposure as a third class once major issuers (Ondo, Maple, Backed) ship on 0G.
- Operator INFTs — open the agent role to multiple verified operators; vault owners pick and rotate without redeploying.

**v2.0 — Sentri as a composable policy envelope (vision)**

Sentri starts as a live AI treasury vault, but the broader vision is a composable policy envelope for AI-driven capital across DeFi.

Any app can generate intelligence, a DAO dashboard, a lending protocol, a yield optimizer, or an agent wallet. The missing layer is deciding what that intelligence is allowed to do with capital. External apps keep their own workflow, but sensitive actions can be bounded by Sentri policy: oracle freshness, exposure caps, drawdown limits, cooldowns, slippage, signer checks, TEE attestation, and audit trails.

SkillMint is the first proof of this: an external verified signal enters the Sentri policy flow, is checked against vault policy, and is recorded in the immutable audit trail. The long-term goal is to make that policy envelope reusable by any app that touches AI-driven capital.

Specific roadmap items in this direction:

- Cross-chain coordination: vault funds on any chain, decisions and proofs on 0G.
- Integration with existing treasury platforms (Karpatkey, Llama Risk, Steakhouse) — Sentri vaults as managed accounts inside their dashboards.
- Public on-chain operator track records: every operator INFT accrues a permanent performance record (PnL, drawdown realised vs bound, frequency of defensive overrides).
- Developer integration surface: stable interface for partner applications, including authenticated requests, replay protection, execution receipts, and verifiable audit trails.

The thesis: the treasury problem is not about clever trading, it is about **bounded productive capital with cryptographic recourse**. Every roadmap item makes that envelope more useful or more verifiable, never the agent more powerful relative to the vault.

---

## Submission

Sentri was submitted to the [0G APAC Hackathon], Track 2: Agentic Trading Arena (Verifiable Finance). The submission summary lives in [`SUBMISSION.md`](./SUBMISSION.md); the demo video walkthrough is linked from the HackQuest entry.

Live demo : https://sentri-web-dusky.vercel.app/

## Contributing

Issues and pull requests welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the development setup, testing requirements, and commit / PR conventions.

## License

[MIT](./LICENSE).
