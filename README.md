# Sentri

**Verifiable autonomous treasury for stablecoin reserves.**
Private strategy, verifiable results.

Sentri is a multi-tenant verifiable treasury protocol. Anyone can deploy their own treasury vault — owned by them, with their own risk policy — and a shared agent operates across all vaults: requesting strategy through a verifiable **0G Sealed Inference** TEE provider path, executing under on-chain policy each vault enforces, and writing per-vault audit trails to **0G Storage**.

The vault holds a stable base asset as the home asset. On Galileo this is `MockUSDC` for deterministic rehearsal; the 0G mainnet asset model is `USDC.E` / bridged USDC, not native Circle USDC. The agent has bounded discretion (preset policies cap post-trade risk exposure at 15% / 30% / 50% depending on the chosen risk tier) to deploy capital into productive risk exposure when conditions are constructive — and to deleverage automatically when they aren't.

Built for **DAOs, protocol reserves, and foundations** that hold stablecoin reserves and want intelligent — and verifiable — productive deployment, without trusting a black-box trader. Submitted to the **0G APAC Hackathon** — Track 2: *Agentic Trading Arena (Verifiable Finance)*.

> Sentri is **not** a trading bot. It is a *stables-first verifiable treasury* with per-vault pause and kill controls. Each vault's owner can withdraw all vault assets immediately, or attempt an emergency deleverage to the base stable asset with a slippage guard.

---

## The problem

DAOs, protocols, and foundations hold **$26B+ in on-chain stablecoin reserves** that mostly sit idle. Putting that capital to work has two existing options, both bad:

- **Manual deployment** — slow, emotional, expensive in attention; treasurers freeze on volatility.
- **Bot-driven yield farming** — public strategies, frontrunnable, opaque about how decisions are made, no recourse when they misbehave.

Neither is acceptable for a treasury that needs **both autonomy and auditability** — capital preservation as the floor, productivity as the upside, transparency as the contract.

## The answer

A treasury infrastructure where:
- Every user owns their own vault contract (factory-deployed clone) with their own policy.
- A shared agent operates across all vaults, with reasoning requested through a **0G verifiable TEE provider path** so the strategy flow is private/auditable without exposing operator-side prompts in the UI.
- Execution is **gated by each vault's on-chain policy** — the agent literally cannot break the constraints.
- Every decision is **cryptographically attested** and the audit trail is verifiable on 0G Storage.
- The vault owner can **pause, reconfigure, or kill** their vault at any moment. The hard kill returns all assets; the deleverage kill attempts to convert residual risk exposure to the base stable asset first.

```
┌──────────────┐   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐   ┌──────────────┐
│ Market data  │ → │ Sealed        │ → │ Per-vault     │ → │ On-chain      │ → │ 0G Storage   │
│ risk/base    │   │ Inference TEE │   │ policy check  │   │ swap          │   │ per-vault    │
└──────────────┘   └───────────────┘   └───────────────┘   └───────────────┘   │ audit trail  │
                       private              public              real           └──────────────┘
                                                                                  verifiable
```

---

## 0G components used (5/6)

| Component | Usage |
|---|---|
| **Chain** | `VaultFactory.sol` deploys per-user `TreasuryVault` clones (EIP-1167 minimal proxies). Every vault enforces its own policy on-chain and emits `StrategyExecuted` events with an execution intent hash, TEE response hash, recovered TEE signer, TEE attestation hash, and deadline for every action. Used intent/response hashes cannot be replayed. |
| **Sealed Inference** | Each strategy decision is computed through a verifiable 0G inference provider. The agent fail-closes unless `processResponse(provider, chatID, content)` returns `true`, then the vault checks the TEE signer's EIP-191 signature over the provider signed chat payload before any swap. |
| **Storage KV** | Per-vault portfolio snapshot (TVL, balances, last action, total executions, P&L) keyed by `keccak256("sentri:portfolio-state:" + vault_address)`. The dashboard reads it via the agent server's `/vault/:address/state` endpoint. |
| **Storage-backed audit** | Per-vault audit entries are written to 0G Storage under keys derived from vault + tx hash + log index + intent hash. Each entry includes the full execution intent, verified model response, signed chat payload, TEE signature, provider metadata, on-chain TX hash, 0G Storage TX hash, and root hash. |
| **Agent ID (INFT)** | `AgentINFT.sol` gates `executeStrategy()` on **every** vault. The vault checks both that `msg.sender` is the registered `agent` address and that the agent holds an active INFT bound to the recovered TEE signer. Owner can revoke the INFT to halt the agent across **all** vaults at once. |

The 6th component (Persistent Memory) is intentionally not used — every strategy decision is stateless and replayable from on-chain + storage data.

---

## Architecture

```
contracts/                       Foundry project (Solidity 0.8.24, OpenZeppelin v5)
  src/
    VaultFactory.sol              EIP-1167 clone factory + presets + per-owner registry
    TreasuryVault.sol             Per-user clone (init pattern). Funds, policy, execution, audit log
    AgentINFT.sol                 Shared agent identity (enclave measurement + revocation)
    SentriSwapRouter.sol          Uniswap v2-style router (single-pair, 0.3% fee)
    JaineV3PoolAdapter.sol        Mainnet adapter for Jaine USDC.E/W0G V3 pool
    SentriPair.sol                Constant-product AMM (MockUSDC ↔ MockWETH on Galileo)
    SentriPriceFeed.sol           AggregatorV3-compatible oracle, pushed by the agent
    MockUSDC.sol                  6-dec stablecoin with public mint (testnet)
    MockWETH.sol                  18-dec risk asset with public mint (testnet)
  test/
    TreasuryVault.t.sol           20 tests (init pattern, deposit/withdraw, strategy, HWM)
    VaultFactory.t.sol            21 tests (presets, custom policy, registry, atomic deposit)
    MultiVault.t.sol              10 integration tests (5 vaults across 3 owners)
    AgentINFT.t.sol               12 tests (mint, revoke, O(k) gas scaling)
    SentriPair.t.sol              8 tests (swap, K invariant, slippage)
                                  Total: 81 unit + integration tests, 0 failing

packages/sdk/                    TypeScript multi-vault agent runtime
  src/
    agent.ts                      setupGlobalContext + discoverVaults + executeOneIterationForVault
                                  + runMultiVaultLoop. Per-cycle: push price once, iterate every vault
                                  with try/catch isolation.
    server.ts                     Express HTTP wrapper. Endpoints:
                                    GET /healthz                  global cycle counters + per-vault summary
                                    GET /vaults                   all known vaults + cached state
                                    GET /vault/:addr/state        per-vault portfolio snapshot
                                    GET /vault/:addr/audit        per-vault recent audit entries
                                    GET /vault/:addr/audit/:ts    single entry with ±5s tolerant lookup
    storage.ts                    0G Storage KV writers, namespaced per vault address.
                                  Local cache mirror at /tmp/sentri-cache/vaults/{addr}/
    inference.ts                  0G Sealed Inference client with TEE attestation
    market.ts                     Risk/USD median oracle (ETH for Galileo, W0G for mainnet)
    setup-broker.ts               One-shot 0G compute broker registration + ledger creation
    cli.ts                        Standalone CLI loop entry (`pnpm agent`)

apps/web/                        Next.js 14 dashboard (App Router, wagmi v2, viem)
  src/app/
    page.tsx                      Landing — public observatory with live protocol stats
    vaults/                       Public vault directory
    v/[address]/                  Per-vault hub with tabs:
      page.tsx                      Overview (stats, agent runtime, deposit/withdraw)
      audit/page.tsx                Audit trail with TEE reasoning enrichment
      policy/page.tsx               Read + update on-chain policy (owner only)
      emergency/page.tsx            Pause/unpause + kill-switch (owner only)
    my/page.tsx                   Vaults owned by the connected wallet
    deploy/page.tsx               4-step onboarding wizard (preset / deposit / confirm / submit)
    api/                          Server-side proxies to the agent server (/vault-state, /vault-audit)
```

### Agent cycle (`packages/sdk/src/agent.ts`, `runMultiVaultLoop`)

Every 5 minutes the agent:

1. **Push price on-chain** — fetch the risk/base market price, then push the median to `SentriPriceFeed`. Galileo rehearsal uses ETH/USD for MockWETH; 0G mainnet uses W0G/USDC.E through the configured W0G market sources. The agent is the sole keeper.
2. **Discover vaults** — call `factory.allVaults()` to pick up any newly-created vaults this cycle.
3. **For each vault** (with per-vault failure isolation):
   - Read state (balances, HWM, policy, execution count).
   - Build a prompt with **deterministically pre-computed metrics** (risk-asset share, deviation from target, drawdown). The LLM never does float math — it pattern-matches against the rule branches in its system prompt.
   - **Sealed Inference**: send to a verifiable TEE provider, require `processResponse(...) === true`, fetch the chat signature, and recover the TEE signer.
   - **Size + execute**: build a canonical `ExecutionIntent`, pass `intentHash`, provider signed chat payload, TEE signature, and attestation hash to `vault.executeStrategy(...)`. Skips emit a structured outcome and continue to next vault.
   - **Audit + state** to 0G Storage, namespaced by vault address. Audit keys include vault + tx hash + log index + intent hash so entries do not collide.

### Strategy doctrine — vol-adjusted regime-aware target (`agent.ts` + `inference.ts`)

Sentri's strategy is *vol-targeting*: instead of one fixed allocation goal, the target risk-asset share moves with the regime so exposure shrinks when the regime is stressed and expands when the regime is calm and constructive. This is the institutional pattern referenced as 2026 best practice for AI-managed crypto treasuries (volatility forecasting → dynamic position sizing → drawdown control).

Three live signals classify the regime — all already known to the agent without any extra fetch:

- **drawdown_from_HWM** — capital preservation
- **24h price change** — directional momentum
- **oracle spread** — Pyth vs Jaine on-chain disagreement, used as a regime-stress proxy (wide spread = unsettled regime)

The matrix below is computed deterministically in TypeScript before the LLM call, so the model never does float math. The LLM either confirms the recommendation or overrides it in a strictly more defensive direction (smaller buy, larger trim, never larger buy than recommended). The TEE attestation binds the resulting decision regardless.

| Regime | Trigger | Target share (Bal / Aggr) |
|---|---|---|
| `drawdown_breach` | drawdown ≥ 1.5% | 0% — full deleverage |
| `crash` | 24h ≤ −3% | 0% — full deleverage |
| `down_wide` | 24h ≤ −1% AND spread ≥ 1% | 10% — defensive lean |
| `down_tight` | 24h ≤ −1% AND spread < 1% | 18% — soft lean |
| `flat` | −1% < 24h < +1% | 22% — neutral, slight under-target |
| `up_wide` | 24h ≥ +1% AND spread ≥ 1% | 20% — tempered enthusiasm |
| `up_tight` | 24h ≥ +1% AND spread < 1% | 25% / **28%** Aggressive |

Hold band is ±3pp around the target (anti-flap). Outside the band the recommendation translates the gap into a concrete `amount_bps` using actual balances + price + TVL. Every step is reproducible off-chain by anyone with the same inputs.

Default state remains 100% base stable asset. Each vault's on-chain `policy` independently caps post-trade risk exposure (15% / 30% / 50% depending on preset) — the matrix never exceeds the cap.

---

## Risk presets (set at vault creation, mutable later by owner)

| Preset | Max alloc | Max drawdown | Max slippage | Cooldown | Use case |
|---|---|---|---|---|---|
| **Conservative** | 15% | 2% | 0.5% | 12 h | Foundation / endowment reserves |
| **Balanced** | 30% | 5% | 1% | 30 min | Standard DAO treasury |
| **Aggressive** | 50% | 10% | 2% | 60 s | Active rebalancer / higher cadence treasuries |
| **Custom** | ≤ 50% | ≤ 20% | ≤ 5% | ≥ 60s | Bounded by factory validation |

Custom policies are validated on-chain at vault creation. Out-of-range values revert with `CustomPolicyOutOfRange`.

---

## 0G asset model

Sentri's treasury thesis is stablecoin-first, but the 0G mainnet stablecoin needs to be named precisely:

- **Galileo rehearsal:** `MockUSDC` / `MockWETH` through `SentriPair`, so judges and contributors can reproduce the full loop without depending on third-party liquidity.
- **0G mainnet target:** `USDC.E` / bridged USDC as the base stable asset, with `W0G` as the primary risk asset and Jaine as the real-market venue.
- **No native-USDC claim:** we do not claim that Circle-issued native USDC is available on 0G mainnet. `USDC.E` is a bridged stablecoin and carries bridge/liquidity risk; Sentri treats that as an explicit asset risk parameter.

The core vault logic is venue-agnostic: it enforces ownership, TEE signer checks, replay/deadline checks, exposure caps, drawdown, cooldown, oracle freshness, and slippage independently from whether the route is the deterministic Galileo AMM or a real 0G mainnet venue. The mainnet path uses `JaineV3PoolAdapter`, which adapts the public Jaine `USDC.E/W0G` V3 pool to the same `swapExactTokensForTokens(...)` surface the vault already uses on Galileo.

Verified 0G mainnet real-asset defaults:

| Asset / venue | Address |
|---|---|
| `W0G` | `0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c` |
| `USDC.E` | `0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E` |
| Jaine `USDC.E/W0G` pool, 0.3% | `0xa9e824Eddb9677fB2189AB9c439238A83695C091` |

---

## Deployed addresses

### 0G Mainnet

Contracts live on **0G Mainnet** (chain ID `16661`). Real-asset deployment using `USDC.E` / `W0G` and Jaine, May 2026.

Deployer / Agent: [`0x981F…20e0`](https://chainscan.0g.ai/address/0x981F6E0Ea94f45fDB8ee7680DC862212E3C720e0)

| Contract | Address |
|---|---|
| `VaultFactory` (entry point) | [`0x1794AADef202E0f39494D27491752B06c0CC26BC`](https://chainscan.0g.ai/address/0x1794AADef202E0f39494D27491752B06c0CC26BC) |
| `TreasuryVault` (impl) | [`0x539ad624e9Be34db7369C6ee0fB22A6dF01C7BEE`](https://chainscan.0g.ai/address/0x539ad624e9Be34db7369C6ee0fB22A6dF01C7BEE) |
| `AgentINFT` | [`0x83C375F3808efAB339276E98C20dddfa69Af3659`](https://chainscan.0g.ai/address/0x83C375F3808efAB339276E98C20dddfa69Af3659) |
| `JaineV3PoolAdapter` | [`0x27647dB3F250EF843BAa7d06F50Bb2648F34c1E2`](https://chainscan.0g.ai/address/0x27647dB3F250EF843BAa7d06F50Bb2648F34c1E2) |
| Jaine `USDC.E/W0G` pool | [`0xa9e824Eddb9677fB2189AB9c439238A83695C091`](https://chainscan.0g.ai/address/0xa9e824Eddb9677fB2189AB9c439238A83695C091) |
| `SentriPriceFeed` | [`0x13a37CC2D39B9615A7e0B773f869AD3998dba0b6`](https://chainscan.0g.ai/address/0x13a37CC2D39B9615A7e0B773f869AD3998dba0b6) |
| `USDC.E` | [`0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E`](https://chainscan.0g.ai/address/0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E) |
| `W0G` | [`0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c`](https://chainscan.0g.ai/address/0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c) |
| Demo vault (Aggressive preset, deployer-owned) | [`0x87dA9a9A5fC6aA33a3379C026482704c41ECc676`](https://chainscan.0g.ai/address/0x87dA9a9A5fC6aA33a3379C026482704c41ECc676) |

Live mainnet proof:

- `VaultFactory.vaultsCount()` returns `1`.
- `VaultFactory.allVaults(0)` returns the demo vault above.
- Demo vault owner is `0x981F6E0Ea94f45fDB8ee7680DC862212E3C720e0`.
- `SentriPriceFeed.keepers(agent)` returns `true`.
- W0G oracle uses Jaine `slot0()` on-chain spot as the primary source, with CoinGecko and GeckoTerminal as external sanity checks. The latest mainnet run used 3/3 sources and `fresh` market health.
- Autonomous execution tx: [`0x30a2d51a2802fefdea4c5135dc3ea2f33fa4218ed0b360f9cc4610aa7db3f675`](https://chainscan.0g.ai/tx/0x30a2d51a2802fefdea4c5135dc3ea2f33fa4218ed0b360f9cc4610aa7db3f675), where the TEE-signed `EmergencyDeleverage` intent swapped W0G into USDC.E through the hardened Jaine adapter.
- Audit entry written to 0G Storage KV: tx `0x223c5e0419655c577223d6aff22364380f83d2ff2c8b33651c964edd473b23ea`, root `0xb19c85f49a3fc05fb18d9bd4acd382aeaa39228e3b4207f9be98f1660e556cf0`.
- Portfolio state written to 0G Storage KV: tx `0x5ab6670e64316a40de1120a2f216a3791cccf952ff8db991203ce221b79a1b56`, root `0x2b46977acce1eae129365b93292972099cd0ad377127ef778d1e3b95b727065c`.
- Post-execution demo vault state: `0.008083 USDC.E + 0.005 W0G`, `executionLogCount() == 1`.

### 0G Galileo

All contracts live on **0G Galileo Testnet** (chain ID `16602`). Replay-protected multi-tenant deployment, May 2026.

Deployer / Agent: [`0x7531…dbd8`](https://chainscan-galileo.0g.ai/address/0x7531d467f19d1055accf6b0d22286184f87adbd8)

| Contract | Address |
|---|---|
| `VaultFactory` (entry point) | [`0x8a94F377De5450269e2035C8fAE31dE1E181F10e`](https://chainscan-galileo.0g.ai/address/0x8a94F377De5450269e2035C8fAE31dE1E181F10e) |
| `TreasuryVault` (impl) | [`0x2A33268CbB4a5639063331Db94FD94a8426765C0`](https://chainscan-galileo.0g.ai/address/0x2A33268CbB4a5639063331Db94FD94a8426765C0) |
| `AgentINFT` | [`0x1181A8670d5CA9597D60fEf2A571a14C58F33020`](https://chainscan-galileo.0g.ai/address/0x1181A8670d5CA9597D60fEf2A571a14C58F33020) |
| `SentriSwapRouter` | [`0xD58b37C4d838aad5E0734ba3F0d34DFA34186d7C`](https://chainscan-galileo.0g.ai/address/0xD58b37C4d838aad5E0734ba3F0d34DFA34186d7C) |
| `SentriPair` | [`0x0BeC7F13a4E9DAc95954EcdF3FF2DABd8279700f`](https://chainscan-galileo.0g.ai/address/0x0BeC7F13a4E9DAc95954EcdF3FF2DABd8279700f) |
| `SentriPriceFeed` | [`0x0e75243d34E904Ab925064c8297b36484Ce2aB5E`](https://chainscan-galileo.0g.ai/address/0x0e75243d34E904Ab925064c8297b36484Ce2aB5E) |
| `MockUSDC` | [`0xAcd0cc301eB160aA8C19B02a9Fac9a1967A69bE3`](https://chainscan-galileo.0g.ai/address/0xAcd0cc301eB160aA8C19B02a9Fac9a1967A69bE3) |
| `MockWETH` | [`0x246e6080D736A217C151C3b88890C08e2C249d5E`](https://chainscan-galileo.0g.ai/address/0x246e6080D736A217C151C3b88890C08e2C249d5E) |
| Demo vault (Aggressive preset, deployer-owned) | [`0x5Aa3a7083915F6213238fc8c7461be969d5504e2`](https://chainscan-galileo.0g.ai/address/0x5Aa3a7083915F6213238fc8c7461be969d5504e2) |

Live Galileo proof:

- Demo vault seeded with 1,000 MockUSDC.
- First replay-protected execution is visible in the demo vault explorer activity.
- The execution log exposes `intentHash`, `responseHash`, recovered TEE signer `0x83df4B8EbA7c0B3B740019b8c9a77ffF77D508cF`, TEE attestation hash, and deadline.

---

## Getting started

### Prerequisites
- Node ≥ 20, pnpm ≥ 9
- Foundry (for contracts)
- A wallet with a small amount of Galileo testnet OG (faucet: https://faucet.0g.ai)

### Install

```bash
pnpm install
```

### Use the live deployment (no local setup needed)

1. Open the dashboard at `http://localhost:3000` (or your hosted URL).
2. Connect a wallet on 0G Galileo (chain 16602).
3. Click **Deploy a vault** → choose a preset → optionally seed with testnet USDC → submit.
4. Your vault is now live. The agent will pick it up on its next cycle (≤ 5 min) and start operating.
5. Inspect `/v/[your-vault]` for live state, audit, policy, emergency.

### Run the dashboard locally

```bash
cp apps/web/.env.example apps/web/.env.local   # set AGENT_URL to your agent server URL
pnpm dev
```

Visit http://localhost:3000.

### Run the agent yourself

The agent is a Node.js HTTP service that operates on every vault deployed via the factory. To run your own:

```bash
cp packages/sdk/.env.example packages/sdk/.env  # fill PRIVATE_KEY
pnpm --filter @steward/sdk run setup-broker     # one-shot 0G compute broker registration
pnpm --filter @steward/sdk run server           # long-running HTTP server with /healthz, /state, /audit
# OR
pnpm agent                                       # standalone CLI loop (no HTTP wrapper)
```

The agent wallet must (1) be registered as `agent` on the VaultFactory (immutable, set at factory deploy), (2) hold an active Agent INFT, and (3) be a registered keeper on `SentriPriceFeed`. The official deployer wallet at the addresses above is configured for all three.

### 0G SDK note

The SDK currently uses `@0glabs/0g-serving-broker` 0.7.4 because it exposes the Direct Compute broker methods used by this hackathon flow, including `processResponse()` and chat signature retrieval. The package's ESM entry is loaded through its CJS path in the agent because the published ESM export is currently unreliable in this environment.

### Re-deploy contracts (only if you fork)

```bash
cd contracts
cp .env.example .env                             # fill PRIVATE_KEY + AGENT_ADDRESS
forge build
forge test
forge script script/Deploy.s.sol --rpc-url galileo --broadcast --priority-gas-price 2000000000
```

The deploy script outputs every address. Update `packages/sdk/src/constants.ts` and `apps/web/src/config/contracts.ts` with the new factory address.

### Deploy the 0G mainnet real-asset stack

Use a fresh mainnet key. Do not reuse a testnet/demo key.

```bash
cd contracts
cp .env.example .env                             # fill PRIVATE_KEY_MAINNET + AGENT_ADDRESS_MAINNET + TEE_SIGNER_ADDRESS
forge build
forge script script/DeployMainnetReal.s.sol --rpc-url https://evmrpc.0g.ai --broadcast
```

Then run the agent/dashboard in mainnet mode:

```bash
SENTRI_NETWORK=mainnet
MARKET_ASSET=W0G
SENTRI_BASE_SYMBOL=USDC.E
SENTRI_RISK_SYMBOL=W0G
NEXT_PUBLIC_SENTRI_NETWORK=mainnet
NEXT_PUBLIC_BASE_SYMBOL=USDC.E
NEXT_PUBLIC_RISK_SYMBOL=W0G
```

Override the deployed mainnet `NEXT_PUBLIC_*` addresses with the script output. The mainnet script creates an empty demo vault; any `USDC.E` deposit is an explicit owner action.

---

## Test suite

```bash
cd contracts && forge test
```

Output: **81 tests passing across 5 suites** (TreasuryVault: 27, AgentINFT: 12, SentriPair: 8, VaultFactory: 21, MultiVault: 13).

Notable coverage:
- Init pattern guard (impl disabled, double-init revert, zero-address)
- Per-vault policy enforcement (cooldown, post-trade risk exposure, drawdown, slippage, stale price)
- Cross-vault isolation (one vault's pause doesn't affect others; one owner can't touch another's vault; shared INFT revocation freezes all vaults at once)
- HWM proportional scaling on withdraw (a withdrawal shrinks the vault but does not register as strategy drawdown)
- AMM K-invariant on swaps both directions
- Custom policy bound enforcement (out-of-range reverts)

---

## Demo

Three-minute video walkthrough: record and submit a public Loom/YouTube link with the HackQuest entry.

The demo covers one full lifecycle:

1. Visitor lands on the public observatory, sees live protocol stats.
2. Connects wallet, mints testnet USDC.
3. Goes to **Deploy** → chooses Balanced → deposits 1,000 USDC → vault created in one TX.
4. Watches the agent execute on the new vault on the next cycle (~5 min).
5. Inspects `/v/[address]/audit` to see the on-chain intent hash, response hash, recovered TEE signer, provider metadata, storage tx/root hash, and hash-match status.
6. Updates policy, then activates kill-switch — either all assets are returned instantly, or the owner uses the deleverage kill to attempt a base-stable-only exit with slippage protection.

---

## Trust boundary

We don't oversell what's verified on-chain vs off-chain. Here's the honest map.

### What the chain verifies (on every executeStrategy)

- **Caller is the registered agent** — `msg.sender == agent` (set at vault creation, owner-mutable).
- **Caller holds an active Agent INFT bound to the recovered TEE signer** — the vault recovers the signer from the provider signed chat payload and checks `agentNFT.isActiveAgentWithSigner(msg.sender, teeSigner)`. Owner can revoke any time.
- **TEE signer signature over the chat payload** — the vault verifies the EIP-191 signature over the provider signed payload before swapping.
- **Intent freshness and replay protection** — each execution includes a deadline checked on-chain, and both the `intentHash` and signed `responseHash` are single-use.
- **Cooldown elapsed** — `block.timestamp ≥ lastExecutionTime + cooldownPeriod`.
- **Post-trade risk exposure within policy** — risk-on actions revert if risk-asset value after the swap exceeds `maxAllocationBps` of TVL. Emergency deleverage is never blocked by the exposure cap.
- **Drawdown within policy** — post-trade TVL must remain within `maxDrawdownBps` of the high-water mark.
- **Oracle price is fresh** — `block.timestamp - oracleUpdatedAt ≤ maxPriceStaleness`.
- **Swap respects oracle slippage bound** — `minOut = expected × (1 − maxSlippageBps)`. Router reverts otherwise.
- **Vault is not paused or killed.**
- **Re-entrancy guarded.**

### What the chain DOES NOT verify (and why this is honest)

- **The full TEE attestation report is NOT cryptographically verified on-chain.** The agent verifies the 0G response off-chain with `broker.inference.processResponse(provider, chatID, content)` and the vault verifies the TEE signer signature over the provider signed chat payload on-chain. The on-chain check proves the payload came from the INFT-bound TEE signer; the broader provider attestation and service verification remain off-chain and auditable.
- **The contract does not parse the model JSON response.** The vault verifies the TEE signer, deadline, and single-use hashes on-chain, then stores the intent/response hashes for audit. The enriched audit page binds the verified model response, signed chat payload, reconstructed execution intent, transaction hash, and 0G Storage proof for human verification.
- **The off-chain decision is taken by the agent**, not by the contract. The contract enforces bounds; it does not compute the strategy. A malicious agent inside the bounded envelope can still pick the worst-of-allowed-actions, but it cannot exceed risk exposure, drawdown, slippage, or cooldown.
- **The market price uses a two-source minimum, network-appropriate per asset.** On 0G mainnet (W0G), the agent fetches the price from **Jaine V3 `slot0()` on-chain** and from **Pyth Network** (Hermes endpoint) — Pyth is 0G's official day-1 oracle integration with 100+ institutional publishers (Cboe, Binance, OKX, Jane Street, etc.). Both must succeed for trading to be enabled, the spread between them is bounded (≤5% by default), and CoinGecko is queried opportunistically for 24h change only — its failure does not block trading. On Galileo (ETH), the agent uses a 4-CEX median (Binance, CoinGecko, Coinbase, Kraken) with a 2-of-4 quorum since these endpoints don't rate-limit ETH. A coordinated manipulation across the on-chain Jaine pool **and** the Pyth publisher set would be required to push a bad mainnet price.
- **The Galileo swap routes through `SentriPair`**, an in-protocol AMM seeded with `MockUSDC`/`MockWETH` for testnet reproducibility. The 0G mainnet target is a real route using `USDC.E` / bridged USDC and `W0G` on Jaine or an equivalent verified venue.

### What this means for the user

A vault owner can reason about Sentri's safety along **two independent dimensions**:

1. **Bound** — what's the worst the agent can do within policy? This is fully on-chain and tight: bounded post-trade risk exposure, bounded drawdown from peak, bounded slippage per swap, bounded cadence (cooldown). The owner sets the bounds at vault creation and can update them; the agent cannot.
2. **Recourse** — what happens if something goes wrong? `pause()` blocks all activity reversibly; `emergencyWithdraw()` returns 100% of base + risk assets to the owner irreversibly; `emergencyDeleverageAndWithdraw(minBaseOut)` attempts to swap all risk exposure to the base stable asset first and reverts if the slippage guard cannot be met. All are owner-only and not gated by the agent or the price feed.

The TEE story is now split honestly: 0G response verification and provider attestation happen off-chain in the agent, while the vault checks the recovered TEE signer signature on-chain, rejects expired/replayed intents, and commits the intent hash for audit replay.

---

## What is intentionally out of scope

- **Active trading / perp strategies.** Sentri rebalances and risk-manages — it does not chase short-term alpha. The interesting privacy story is *which constraints the agent enforces in private*, not *which trades it places*.
- **Multiple risk assets.** Sentri supports one base stable asset and one risk asset per vault.
- **Multi-chain.** v1 targets 0G mainnet for review and Galileo for rehearsal. Cross-chain coordination is out of scope.
- **Agent marketplace / operator competition.** Single shared agent (us). Aegis Vault occupies that lane; we differentiate on focus.
- **Persistent memory across iterations.** Stateless by design — auditability first.
- **Formal audit.** Contracts are covered by focused Foundry tests and static review, but have not undergone a third-party audit.

---

## License

MIT — see [LICENSE](./LICENSE).
