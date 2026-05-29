# Sentri
## AI agents are getting wallets. Sentri keeps them on a leash. 

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/solidity-0.8.24-363636.svg)](./contracts/foundry.toml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-43853d.svg)](./package.json)
[![Tests](https://img.shields.io/badge/forge%20tests-105%20passing-brightgreen.svg)](./contracts/test)
[![0G Mainnet](https://img.shields.io/badge/0G-mainnet%2016661-FFB300.svg)](https://chainscan.0g.ai/address/0x9EE0c94c87FaDeB6dFb619B2C429eC05bc623cc7)

**Verified AI treasury execution with hard on-chain limits, for stablecoin reserves on 0G.**
Private strategy, verifiable results. The agent proposes, the vault disposes.

Sentri is a multi-tenant treasury protocol. Anyone can deploy their own bounded vault from a public factory, with their own risk policy. A shared agent operates across every vault: it requests strategy through a verifiable 0G Sealed Inference TEE provider path, and the vault enforces every cryptographic and economic check on-chain before any swap can fire. The vault owner can pause, reconfigure, or hard-kill at any moment.

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

Demo live: https://sentri-web-dusky.vercel.app/


Mainnet deployment:

• VaultFactory: 0x9EE0c94c87FaDeB6dFb619B2C429eC05bc623cc7

• TreasuryVault impl: 0xf86013C68811047F6dEc98c4ED6601C80B720668

• AgentINFT: 0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951

• JaineV3PoolAdapter: 0xAdf55d5380f216F53f109B6B8341C9169BaeEBa4

• SentriPriceFeed: 0x1289638A90da7F24DB069168648819607A7377e6

• Demo vault (Aggressive): 0x20e8B2De8Ac2c8c5EE662Ea9986EC280FaebcA8E


| Question | Answer |
|---|---|
| What is Sentri? | A policy-first autonomous treasury vault on 0G. |
| Is it live on mainnet? | Yes, deployed on 0G mainnet `16661`. |
| Does it move real assets? | Yes, `USDC.E/W0G` through Jaine. |
| What 0G components are used? | 5 highlighted 0G surfaces: Chain, Compute TeeML, TEE/Private Sandbox, Storage KV + Log Layer, Agent INFT-style identity profile — Jaine is the real 0G mainnet execution venue. |
| Is the AI trusted blindly? | No, the vault enforces signer, replay, deadline, exposure, drawdown, slippage, oracle freshness, pause and kill. |
| Can judges verify it? | Yes, public dashboard, chainscan links, execution txs, storage root hashes, and storage tx links when available. |

---

## Features

- **Multi-tenant factory.** Anyone deploys their own `TreasuryVault` clone (EIP-1167 minimal proxy) with their own risk policy. Per-vault registry, per-vault audit trail, per-vault kill controls.
- **AI as defensive verifier.** A deterministic vol-adjusted regime-aware matrix computes the safe action envelope. The TeeML LLM may confirm the recommendation or pick a strictly more cautious one — never more aggressive. `validateAgainstRecommendation()` machine-checks this in the call path.
- **Spread-bounded oracle path.** Each cycle requires Jaine V3 `slot0()` on-chain plus Pyth Network `0G/USD` via Hermes. 2-of-2 quorum, spread-bounded, then keeper-pushed to `SentriPriceFeed`.
- **Real assets, real venue.** The mainnet stack uses `USDC.E` and `W0G`, with execution routed through the live Jaine V3 `USDC.E/W0G` pool via a hardened single-pool adapter.
- **Owner recourse always available.** `pause` to freeze activity reversibly, `emergencyWithdraw` to return all assets immediately, `emergencyDeleverageAndWithdraw(minBaseOut)` to attempt a base-asset exit with slippage protection.

## 0G integration

Sentri uses 5 highlighted 0G surfaces + 1 real 0G mainnet ecosystem venue.

| Layer | Usage |
|---|---|
| 0G Chain | `VaultFactory` and `TreasuryVault` deployed natively on mainnet `16661`. |
| 0G Compute / Sealed Inference (TeeML) | `processResponse()` fail-closed, then EIP-191 verification of the recovered TEE signer on-chain. |
| 0G TEE / Private Sandbox | Strategy reasoning runs inside the sealed provider path; `chatID`, signed payload, and recovered signer are propagated to the audit trail for verifiable review. |
| 0G Storage Log Layer (blob) | Immutable canonical audit record uploaded per execution; root hash and optional storage tx metadata are mirrored into the per-vault KV/cache index for tamper-evidence. |
| 0G Storage KV | Fast per-vault audit index and portfolio state, namespaced by vault address; used as recovery layer after agent restart. |
| Agent INFT | ERC-7857-aligned Agentic ID execution profile: gates `executeStrategy` on every vault; owner-revocable kill-switch across all vaults at once. |
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
| `VaultFactory` (entry point) | [`0x9EE0c94c87FaDeB6dFb619B2C429eC05bc623cc7`](https://chainscan.0g.ai/address/0x9EE0c94c87FaDeB6dFb619B2C429eC05bc623cc7) |
| `TreasuryVault` impl | [`0xf86013C68811047F6dEc98c4ED6601C80B720668`](https://chainscan.0g.ai/address/0xf86013C68811047F6dEc98c4ED6601C80B720668) |
| `AgentINFT` | [`0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951`](https://chainscan.0g.ai/address/0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951) |
| `JaineV3PoolAdapter` | [`0xAdf55d5380f216F53f109B6B8341C9169BaeEBa4`](https://chainscan.0g.ai/address/0xAdf55d5380f216F53f109B6B8341C9169BaeEBa4) |
| Jaine `USDC.E/W0G` pool, 0.3% | [`0xa9e824Eddb9677fB2189AB9c439238A83695C091`](https://chainscan.0g.ai/address/0xa9e824Eddb9677fB2189AB9c439238A83695C091) |
| `SentriPriceFeed` | [`0x1289638A90da7F24DB069168648819607A7377e6`](https://chainscan.0g.ai/address/0x1289638A90da7F24DB069168648819607A7377e6) |
| `USDC.E` | [`0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E`](https://chainscan.0g.ai/address/0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E) |
| `W0G` | [`0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c`](https://chainscan.0g.ai/address/0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c) |
| Demo vault (Aggressive preset) | [`0x20e8B2De8Ac2c8c5EE662Ea9986EC280FaebcA8E`](https://chainscan.0g.ai/address/0x20e8B2De8Ac2c8c5EE662Ea9986EC280FaebcA8E) |
| Primary v2 execution tx — `EmergencyDeleverage` (`W0G → USDC.E`) | [`0x4b44c506…9ac4`](https://chainscan.0g.ai/tx/0x4b44c5063ca3b7f618a6dab5c20e840cb7d605e761162b6fbe847995df3d9ac4) |

`USDC.E` is bridged USDC on 0G mainnet, not native Circle USDC. Recovered TEE signer on the current demo execution: `0x4386909Ef321651ab78298Ae454A05FF5d354118`.

### Trustless Oracle Vault — Canary V2 (validated, activation pending)

A premium execution tier that replaces the keeper-pushed price step with a **Pyth pull oracle verified on-chain in the same transaction**. Deployed and validated at the contract level on 0G mainnet; **not** yet the live production path — the standard keeper path above remains the operating path. Source: [`feature/trustless-oracle-vault`](https://github.com/RedGnad/Sentri/tree/feature/trustless-oracle-vault).

| Contract / tx | Address |
|---|---|
| `VaultFactoryV2` | [`0xA3588d…CF58C`](https://chainscan.0g.ai/address/0xA3588d1964F7CeCDcFac15e38D286554955CF58C) |
| `TreasuryVaultTrustlessOracle` impl | [`0x0F8b9A…140B`](https://chainscan.0g.ai/address/0x0F8b9A0c064306F938912658c96c681D8655140B) |
| Canary vault (Balanced preset) | [`0x86cE22…f40ed`](https://chainscan.0g.ai/address/0x86cE22c597D0C4EC309ba166360686C39A3f40ed) |
| Pyth oracle (0G mainnet) | [`0x2880aB…7B43`](https://chainscan.0g.ai/address/0x2880aB155794e7179c9eE2e38200202908C17B43) |
| Pyth feed `Crypto.0G/USD` | `0xfa9e8d45…ea3070` |
| `createVault` tx | [`0x81cff80a…f4fcb8`](https://chainscan.0g.ai/tx/0x81cff80ace50a2cfb8051c015505667c5df7812e754a0c4b56a6fdf410f4fcb8) |
| `setAuthorizedFactory` tx (owner) | [`0x7c018f9f…87a3d55`](https://chainscan.0g.ai/tx/0x7c018f9fbd7050a7369267be0272c7a31bf9a9bf7cb16eea5c224446887a3d55) |

**V1 vs V2.** V1 (live): price keeper-pushed to `SentriPriceFeed` (Jaine `slot0()` + Pyth Hermes, 2-of-2 quorum off-chain). V2 (canary): each `executeStrategyWithPyth()` carries a signed Pyth update verified on-chain in the same tx — the keeper-pushed step is removed from the execution path — and the verified price drives `minOut`, exposure, drawdown and TVL, under `pythMaxAge = 60s` and `pythMaxConfBps = 200`.

**Exact scope (no overclaiming).** Pyth price is pull-verified on-chain per execution. The TEE binding is signer-based (ECDSA recovery against the AgentINFT-bound signer); the contract does not parse the full TEE attestation report, and there is **no on-chain Jaine/Pyth cross-check yet**. The canary proves **deployment + authorization** (`isAuthorizedForVault = true`); a full economic `executeStrategyWithPyth()` is a separate, agent-signed proof.

Verify it yourself (read-only, no key): `pnpm --filter @steward/sdk verify:trustless-canary`.

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
| Demo vault(Agressive preset) | [`0x20e8B2De8Ac2c8c5EE662Ea9986EC280FaebcA8E`](https://chainscan-galileo.0g.ai/address/0x20e8B2De8Ac2c8c5EE662Ea9986EC280FaebcA8E) |

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

105 tests passing across 6 suites: `TreasuryVault` (30), `VaultFactory` (21), `MultiVault` (13), `AgentINFT` (28), `SentriPair` (8), `JaineV3PoolAdapter` (5). See [`docs/architecture.md`](./docs/architecture.md#test-coverage) for coverage detail.

---

## Architecture

The protocol has three layers: a Solidity contract suite (factory + per-user vaults + Jaine adapter + agent INFT + price feed), a TypeScript agent runtime that runs the cycle (price push → vault discovery → TEE inference → policy-checked execution → 0G Storage write), and a Next.js dashboard that exposes per-vault overview, audit, policy and emergency controls.

For the full per-file breakdown, agent cycle steps, regime matrix, defensive-verifier contract, and trust boundary detail, see [`docs/architecture.md`](./docs/architecture.md).

---

## Trust boundary (summary)

Sentri does not oversell what's verified on-chain.

The chain verifies: registered agent caller, active Agent INFT bound to the recovered TEE signer, EIP-191 signature on the provider chat payload, intent freshness (deadline) and replay protection (single-use intent and response hashes), cooldown, post-trade exposure cap, drawdown bound, oracle freshness, slippage bound, pause/kill state, and re-entrancy.

The chain does **not** verify the full TEE attestation report, does not parse the model JSON, and does not compute the strategy itself. The agent decides; the contract enforces bounds. A malicious agent inside the bounded envelope can still pick the worst-of-allowed actions, but cannot exceed risk exposure, drawdown, slippage, or cooldown.

The market price uses a 2-source minimum: on mainnet the agent fetches Jaine `slot0()` on-chain plus Pyth `0G/USD` via Hermes, both must succeed and agree within the spread bound, and the median is keeper-pushed to `SentriPriceFeed`. Pyth on-chain pull evidence path is implemented; trading still uses `SentriPriceFeed` enforcement. CoinGecko is opportunistic for 24h change only and never gates trading.

For the complete enumeration, see [`docs/architecture.md#trust-boundary`](./docs/architecture.md#trust-boundary).

---

## Roadmap

This is a forward-looking section.

**Next hardening (weeks)**

- Pyth on-chain pull integration: **canary deployed + validated on mainnet** (see "Trustless Oracle Vault — Canary V2" above) — the vault reads the deployed Pyth contract (`0x2880ab15…7b43`) directly via `updatePriceFeeds`, removing the keeper-pushed step. Remaining: full economic `executeStrategyWithPyth()` proof + agent activation.
- Jaine TWAP cross-check on `slot0()` once `observe()` cardinality permits a 30-minute window — flash-trade-resistant manipulation guard.
- - Harden canonical audit recovery from 0G Storage Log/blob + KV index: canonical blobs and root-based recovery are live; next step is full generic offline verification and restart-proof indexing without demo recovery records.
- Third-party security audit.

**Future productive treasury extensions (months)**

- Yield-bearing base asset (`sUSDS` / `sUSDe` / `sFRAX` / any 4626-compatible) — idle capital earns the staking rate.
- Multi-asset risk side: vol-weighted basket (W0G + ETH + tokenized RWAs) instead of one risk asset per vault.
- RWA exposure as a third class once major issuers (Ondo, Maple, Backed) ship on 0G.
- Operator INFTs — open the agent role to multiple verified operators; vault owners pick and rotate without redeploying.

**v2.0 — Sentri as a composable policy envelope (vision)**

Sentri starts as a live AI treasury vault, but the broader vision is a composable policy envelope for AI-driven capital across DeFi.

Any app can generate intelligence — a DAO dashboard, a lending protocol, a yield optimizer, or an agent wallet. The missing layer is deciding what that intelligence is allowed to do with capital. External apps keep their own workflow, but sensitive actions can be bounded by Sentri policy: oracle freshness, exposure caps, drawdown limits, cooldowns, slippage, signer checks, TEE attestation, and audit trails.

SkillMint is the first proof of this: an external verified signal enters the Sentri policy flow, is checked against vault policy, and is recorded in the immutable audit trail. The long-term goal is to make that policy envelope reusable by any app that touches AI-driven capital.

Specific roadmap items in this direction:

- Cross-chain coordination: vault funds on any chain, decisions and proofs on 0G.
- Integration with existing treasury platforms (Karpatkey, Llama Risk, Steakhouse) — Sentri vaults as managed accounts inside their dashboards.
- Public on-chain operator track records: every operator INFT accrues a permanent performance record (PnL, drawdown realised vs bound, frequency of defensive overrides).
- Developer integration surface: stable interface for partner applications, including authenticated requests, replay protection, execution receipts, and verifiable audit trails.

The thesis: the treasury problem is not about clever trading — it is about **bounded productive capital with cryptographic recourse**. Every roadmap item makes that envelope more useful or more verifiable, never the agent more powerful relative to the vault.

---

## Submission

Sentri was submitted to the [0G APAC Hackathon], Track 2: Agentic Trading Arena (Verifiable Finance). The submission summary lives in [`SUBMISSION.md`](./SUBMISSION.md); the demo video walkthrough is linked from the HackQuest entry.

Live demo : https://sentri-web-dusky.vercel.app/

## Contributing

Issues and pull requests welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the development setup, testing requirements, and commit / PR conventions.

## License

[MIT](./LICENSE).
