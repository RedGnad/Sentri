# Sentri

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/solidity-0.8.24-363636.svg)](./contracts/foundry.toml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-43853d.svg)](./package.json)
[![Tests](https://img.shields.io/badge/forge%20tests-86%20passing-brightgreen.svg)](./contracts/test)
[![0G Mainnet](https://img.shields.io/badge/0G-mainnet%2016661-FFB300.svg)](https://chainscan.0g.ai/address/0x1794AADef202E0f39494D27491752B06c0CC26BC)

**Verifiable autonomous treasury for stablecoin reserves on 0G.**
Private strategy, verifiable results. The agent proposes, the vault disposes.

Sentri is a multi-tenant treasury protocol. Anyone can deploy their own bounded vault from a public factory, with their own risk policy. A shared agent operates across every vault: it requests strategy through a verifiable [0G Sealed Inference](https://docs.0g.ai/) TEE provider path, and the vault enforces every cryptographic and economic check on-chain before any swap can fire. The vault owner can pause, reconfigure, or hard-kill at any moment.

```
┌──────────────┐   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐   ┌──────────────┐
│ Market data  │ → │ Sealed        │ → │ Per-vault     │ → │ On-chain      │ → │ 0G Storage   │
│ risk/base    │   │ Inference TEE │   │ policy check  │   │ swap          │   │ per-vault    │
└──────────────┘   └───────────────┘   └───────────────┘   └───────────────┘   │ audit trail  │
                       private              public              real           └──────────────┘
                                                                                  verifiable
```

---

## Features

- **Multi-tenant factory.** Anyone deploys their own `TreasuryVault` clone (EIP-1167 minimal proxy) with their own risk policy. Per-vault registry, per-vault audit trail, per-vault kill controls.
- **AI as defensive verifier.** A deterministic vol-adjusted regime-aware matrix computes the safe action envelope. The TeeML LLM may confirm the recommendation or pick a strictly more cautious one — never more aggressive. `validateAgainstRecommendation()` machine-checks this in the call path.
- **Decentralised oracle path.** Each cycle requires Jaine V3 `slot0()` on-chain plus Pyth Network `0G/USD` via Hermes (Pyth is 0G's day-one official oracle integration). 2-of-2 quorum, spread-bounded, then keeper-pushed to `SentriPriceFeed`.
- **Real assets, real venue.** The mainnet stack uses `USDC.E` and `W0G`, with execution routed through the live Jaine V3 `USDC.E/W0G` pool via a hardened single-pool adapter.
- **Owner recourse always available.** `pause` to freeze activity reversibly, `emergencyWithdraw` to return all assets immediately, `emergencyDeleverageAndWithdraw(minBaseOut)` to attempt a base-asset exit with slippage protection.

## 0G integration (5 of 6 components used)

- **0G Chain** — `VaultFactory` and `TreasuryVault` deployed natively on mainnet `16661`.
- **0G Compute / Sealed Inference (TeeML)** — `processResponse()` fail-closed, then EIP-191 verification of the recovered TEE signer on-chain.
- **0G Storage KV** — per-vault audit trail and portfolio state, namespaced by vault address.
- **Agent INFT** — gates `executeStrategy` on every vault; owner-revocable kill-switch across all vaults at once.
- **Real DEX integration** — `JaineV3PoolAdapter`, locked to the immutable Jaine pool address.

The 6th component (Persistent Memory) is intentionally not used: every strategy decision is stateless and replayable from on-chain plus storage data.

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

### 0G Mainnet (chain `16661`)

| Contract | Address |
|---|---|
| `VaultFactory` (entry point) | [`0x1794AADef202E0f39494D27491752B06c0CC26BC`](https://chainscan.0g.ai/address/0x1794AADef202E0f39494D27491752B06c0CC26BC) |
| `TreasuryVault` impl | [`0x539ad624e9Be34db7369C6ee0fB22A6dF01C7BEE`](https://chainscan.0g.ai/address/0x539ad624e9Be34db7369C6ee0fB22A6dF01C7BEE) |
| `AgentINFT` | [`0x83C375F3808efAB339276E98C20dddfa69Af3659`](https://chainscan.0g.ai/address/0x83C375F3808efAB339276E98C20dddfa69Af3659) |
| `JaineV3PoolAdapter` | [`0x27647dB3F250EF843BAa7d06F50Bb2648F34c1E2`](https://chainscan.0g.ai/address/0x27647dB3F250EF843BAa7d06F50Bb2648F34c1E2) |
| Jaine `USDC.E/W0G` pool, 0.3% | [`0xa9e824Eddb9677fB2189AB9c439238A83695C091`](https://chainscan.0g.ai/address/0xa9e824Eddb9677fB2189AB9c439238A83695C091) |
| `SentriPriceFeed` | [`0x13a37CC2D39B9615A7e0B773f869AD3998dba0b6`](https://chainscan.0g.ai/address/0x13a37CC2D39B9615A7e0B773f869AD3998dba0b6) |
| `USDC.E` | [`0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E`](https://chainscan.0g.ai/address/0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E) |
| `W0G` | [`0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c`](https://chainscan.0g.ai/address/0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c) |
| Demo vault (Aggressive preset) | [`0x87dA9a9A5fC6aA33a3379C026482704c41ECc676`](https://chainscan.0g.ai/address/0x87dA9a9A5fC6aA33a3379C026482704c41ECc676) |

`USDC.E` is bridged USDC on 0G mainnet, not native Circle USDC. Recovered TEE signer on every successful execution: `0xA46EA4FC5889AD35A1487e1Ed04dCcfa872146B9`.

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

86 tests passing across 6 suites: `TreasuryVault` (27), `VaultFactory` (21), `MultiVault` (13), `AgentINFT` (12), `SentriPair` (8), `JaineV3PoolAdapter` (5). See [`docs/architecture.md`](./docs/architecture.md#test-coverage) for coverage detail.

---

## Architecture

The protocol has three layers: a Solidity contract suite (factory + per-user vaults + Jaine adapter + agent INFT + price feed), a TypeScript agent runtime that runs the cycle (price push → vault discovery → TEE inference → policy-checked execution → 0G Storage write), and a Next.js dashboard that exposes per-vault overview, audit, policy and emergency controls.

For the full per-file breakdown, agent cycle steps, regime matrix, defensive-verifier contract, and trust boundary detail, see [`docs/architecture.md`](./docs/architecture.md).

---

## Trust boundary (summary)

Sentri does not oversell what's verified on-chain.

The chain verifies: registered agent caller, active Agent INFT bound to the recovered TEE signer, EIP-191 signature on the provider chat payload, intent freshness (deadline) and replay protection (single-use intent and response hashes), cooldown, post-trade exposure cap, drawdown bound, oracle freshness, slippage bound, pause/kill state, and re-entrancy.

The chain does **not** verify the full TEE attestation report, does not parse the model JSON, and does not compute the strategy itself. The agent decides; the contract enforces bounds. A malicious agent inside the bounded envelope can still pick the worst-of-allowed actions, but cannot exceed risk exposure, drawdown, slippage, or cooldown.

The market price uses a 2-source minimum: on mainnet the agent fetches Jaine `slot0()` on-chain plus Pyth `0G/USD` via Hermes, both must succeed and agree within the spread bound, and the median is keeper-pushed to `SentriPriceFeed`. CoinGecko is opportunistic for 24h change only and never gates trading.

For the complete enumeration, see [`docs/architecture.md#trust-boundary`](./docs/architecture.md#trust-boundary).

---

## Roadmap

This is a forward-looking section — none of the items below are live in v1.

**v1.1 — hardening (weeks)**

- Pyth on-chain pull integration: vault reads the deployed Pyth contract (`0x2880ab15…7b43`) directly via `updatePriceFeeds`, removing the keeper-pushed step.
- Jaine TWAP cross-check on `slot0()` once `observe()` cardinality permits a 30-minute window — flash-trade-resistant manipulation guard.
- Migrate audit trail from 0G Storage KV to Log Layer for append-only semantics; KV stays as the fast UI index.
- Third-party security audit.

**v2 — productive treasury (months)**

- Yield-bearing base asset (`sUSDS` / `sUSDe` / `sFRAX` / any 4626-compatible) — idle capital earns the staking rate.
- Multi-asset risk side: vol-weighted basket (W0G + ETH + tokenized RWAs) instead of one risk asset per vault.
- RWA exposure as a third class once major issuers (Ondo, Maple, Backed) ship on 0G.
- Operator INFTs — open the agent role to multiple verified operators; vault owners pick and rotate without redeploying.

**v3 — Sentri as a treasury primitive (vision)**

- Composable risk envelopes across lending, perps, LP — bounded by the same Sentri policy.
- Cross-chain coordination: vault funds on any chain, decisions and proofs on 0G.
- Integration with existing treasury platforms (Karpatkey, Llama Risk, Steakhouse) — Sentri vaults as managed accounts inside their dashboards.
- Public on-chain operator track records: every operator INFT accrues a permanent performance record (PnL, drawdown realised vs bound, frequency of defensive overrides).

The thesis: the treasury problem is not about clever trading — it is about **bounded productive capital with cryptographic recourse**. Every roadmap item makes that envelope more useful or more verifiable, never the agent more powerful relative to the vault.

---

## Submission

Sentri was submitted to the [0G APAC Hackathon](https://www.hackquest.io/hackathons/0G-APAC-Hackathon) — Track 2: Agentic Trading Arena (Verifiable Finance). The submission summary lives in [`SUBMISSION.md`](./SUBMISSION.md); the demo video walkthrough is linked from the HackQuest entry.

## Contributing

Issues and pull requests welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the development setup, testing requirements, and commit / PR conventions.

## License

[MIT](./LICENSE).
