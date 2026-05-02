# Sentri

**Verifiable autonomous treasury for stablecoin reserves.**
Private strategy, verifiable results.

Sentri is a multi-tenant verifiable treasury protocol. Anyone can deploy their own treasury vault — owned by them, with their own risk policy — and a shared agent operates across all vaults: requesting strategy through a verifiable **0G Sealed Inference** TEE provider path, executing under on-chain policy each vault enforces, and writing per-vault audit trails to **0G Storage**.

The vault holds USDC as the home asset. The agent has bounded discretion (preset policies cap post-trade WETH exposure at 15% / 30% / 50% depending on the chosen risk tier) to deploy capital into productive risk exposure when conditions are constructive — and to deleverage automatically when they aren't.

Built for **DAOs, protocol reserves, and foundations** that hold stablecoin reserves and want intelligent — and verifiable — productive deployment, without trusting a black-box trader. Submitted to the **0G APAC Hackathon** — Track 2: *Agentic Trading Arena (Verifiable Finance)*.

> Sentri is **not** a trading bot. It is a *stables-first verifiable treasury* with per-vault pause and kill controls. Each vault's owner can withdraw all vault assets immediately, or attempt an emergency deleverage to USDC with a slippage guard.

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
- The vault owner can **pause, reconfigure, or kill** their vault at any moment. The hard kill returns all assets; the deleverage kill attempts to convert residual WETH to USDC first.

```
┌──────────────┐   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐   ┌──────────────┐
│ Market data  │ → │ Sealed        │ → │ Per-vault     │ → │ On-chain      │ → │ 0G Storage   │
│ (ETH/USD)    │   │ Inference TEE │   │ policy check  │   │ swap          │   │ per-vault    │
└──────────────┘   └───────────────┘   └───────────────┘   └───────────────┘   │ audit trail  │
                       private              public              real           └──────────────┘
                                                                                  verifiable
```

---

## 0G components used (5/6)

| Component | Usage |
|---|---|
| **Chain** | `VaultFactory.sol` deploys per-user `TreasuryVault` clones (EIP-1167 minimal proxies). Every vault enforces its own policy on-chain and emits `StrategyExecuted` events with an execution intent hash, TEE response hash, recovered TEE signer, TEE attestation hash, and deadline for every action. Used intent/response hashes cannot be replayed. |
| **Sealed Inference** | Each strategy decision is computed through a verifiable 0G inference provider. The agent fail-closes unless `processResponse(provider, chatID, content)` returns `true`, then the vault checks the TEE signer's EIP-191 signature over the compact JSON response before any swap. |
| **Storage KV** | Per-vault portfolio snapshot (TVL, balances, last action, total executions, P&L) keyed by `keccak256("sentri:portfolio-state:" + vault_address)`. The dashboard reads it via the agent server's `/vault/:address/state` endpoint. |
| **Storage-backed audit** | Per-vault audit entries are written to 0G Storage under keys derived from vault + tx hash + log index + intent hash. Each entry includes the full execution intent, compact signed response, TEE signature, provider metadata, on-chain TX hash, 0G Storage TX hash, and root hash. |
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
    SentriPair.sol                Constant-product AMM (USDC ↔ WETH)
    SentriPriceFeed.sol           AggregatorV3-compatible oracle, pushed by the agent
    MockUSDC.sol                  6-dec stablecoin with public mint (testnet)
    MockWETH.sol                  18-dec risk asset with public mint (testnet)
  test/
    TreasuryVault.t.sol           20 tests (init pattern, deposit/withdraw, strategy, HWM)
    VaultFactory.t.sol            21 tests (presets, custom policy, registry, atomic deposit)
    MultiVault.t.sol              10 integration tests (5 vaults across 3 owners)
    AgentINFT.t.sol               12 tests (mint, revoke, O(k) gas scaling)
    SentriPair.t.sol              8 tests (swap, K invariant, slippage)
                                  Total: 71 unit + integration tests, 0 failing

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
    market.ts                     ETH/USD oracle (Binance / CoinGecko fallback)
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

1. **Push price on-chain** — fetch ETH/USD spot (Binance, CoinGecko fallback) and push to `SentriPriceFeed`. The agent is the sole keeper.
2. **Discover vaults** — call `factory.allVaults()` to pick up any newly-created vaults this cycle.
3. **For each vault** (with per-vault failure isolation):
   - Read state (balances, HWM, policy, execution count).
   - Build a prompt with **deterministically pre-computed metrics** (WETH share, deviation from target, drawdown). The LLM never does float math — it pattern-matches against the rule branches in its system prompt.
   - **Sealed Inference**: send to a verifiable TEE provider, require `processResponse(...) === true`, fetch the chat signature, and recover the TEE signer.
   - **Size + execute**: build a canonical `ExecutionIntent`, pass `intentHash`, compact signed response, TEE signature, and attestation hash to `vault.executeStrategy(...)`. Skips emit a structured outcome and continue to next vault.
   - **Audit + state** to 0G Storage, namespaced by vault address. Audit keys include vault + tx hash + log index + intent hash so entries do not collide.

### Strategy doctrine (`packages/sdk/src/inference.ts`)

System prompt is a deterministic decision tree, applied in order:

1. 24h change ≤ −3% **or** drawdown ≥ 1.5% → EmergencyDeleverage all WETH back to USDC.
2. WETH share > 30% → EmergencyDeleverage trim back toward 25% target.
3. 20% ≤ WETH share ≤ 30% → hold (no action).
4. WETH share < 20% **and** 24h ≥ +1% **and** drawdown < 1% → deploy USDC toward 25% target.
5. Otherwise → hold (cautious default).

Default state is 100% USDC. Maximum WETH exposure is 30% of TVL by default — never exceeded by the vault. Each vault's on-chain `policy` independently caps post-trade WETH exposure (15% / 30% / 50% depending on preset).

---

## Risk presets (set at vault creation, mutable later by owner)

| Preset | Max alloc | Max drawdown | Max slippage | Cooldown | Use case |
|---|---|---|---|---|---|
| **Conservative** | 15% | 2% | 0.5% | 10 min | Foundation / endowment reserves |
| **Balanced** | 30% | 5% | 1% | 5 min | Standard DAO treasury |
| **Aggressive** | 50% | 10% | 2% | 3 min | Protocol with appetite for productive risk |
| **Custom** | ≤ 50% | ≤ 20% | ≤ 5% | ≥ 60s | Bounded by factory validation |

Custom policies are validated on-chain at vault creation. Out-of-range values revert with `CustomPolicyOutOfRange`.

---

## Deployed addresses

All contracts live on **0G Galileo Testnet** (chain ID `16602`). Phase 1 multi-tenant deployment, May 2026.

Deployer / Agent: [`0x7531…dbd8`](https://chainscan-galileo.0g.ai/address/0x7531d467f19d1055accf6b0d22286184f87adbd8)

| Contract | Address |
|---|---|
| `VaultFactory` (entry point) | [`0xE3cfFc08a8327b7464168a4C17D5AE609bE75153`](https://chainscan-galileo.0g.ai/address/0xE3cfFc08a8327b7464168a4C17D5AE609bE75153) |
| `TreasuryVault` (impl) | [`0x7fDfbee09665fffEB150F500C2CC8326c87B6304`](https://chainscan-galileo.0g.ai/address/0x7fDfbee09665fffEB150F500C2CC8326c87B6304) |
| `AgentINFT` | [`0x3E74C5820e3DF83C331AC058328Dd18C037E151F`](https://chainscan-galileo.0g.ai/address/0x3E74C5820e3DF83C331AC058328Dd18C037E151F) |
| `SentriSwapRouter` | [`0x13173a0F2BB4687F8b601374566649559511D512`](https://chainscan-galileo.0g.ai/address/0x13173a0F2BB4687F8b601374566649559511D512) |
| `SentriPair` | [`0x1C8040c84344641cA4ab3CAE44c2B99c9ec1f137`](https://chainscan-galileo.0g.ai/address/0x1C8040c84344641cA4ab3CAE44c2B99c9ec1f137) |
| `SentriPriceFeed` | [`0xaDb52a49d0398cA048f4027Fe81748Dd666BAfF8`](https://chainscan-galileo.0g.ai/address/0xaDb52a49d0398cA048f4027Fe81748Dd666BAfF8) |
| `MockUSDC` | [`0x93cA5b6fEA5328FAa0ed4B6Cb6a2E82339558792`](https://chainscan-galileo.0g.ai/address/0x93cA5b6fEA5328FAa0ed4B6Cb6a2E82339558792) |
| `MockWETH` | [`0xF25A225562808a00776aAAD4DFC98c6B48Ad5790`](https://chainscan-galileo.0g.ai/address/0xF25A225562808a00776aAAD4DFC98c6B48Ad5790) |
| Demo vault (Balanced preset, deployer-owned) | [`0x435946204b818e82C97362F21Ca8B967F5266F83`](https://chainscan-galileo.0g.ai/address/0x435946204b818e82C97362F21Ca8B967F5266F83) |

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
3. Click **Deploy a vault** → choose a preset → optionally seed with USDC → submit.
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

---

## Test suite

```bash
cd contracts && forge test
```

Output: **77 tests passing across 5 suites** (TreasuryVault: 23, AgentINFT: 12, SentriPair: 8, VaultFactory: 21, MultiVault: 13).

Notable coverage:
- Init pattern guard (impl disabled, double-init revert, zero-address)
- Per-vault policy enforcement (cooldown, post-trade WETH exposure, drawdown, slippage, stale price)
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
6. Updates policy, then activates kill-switch — either all assets are returned instantly, or the owner uses the deleverage kill to attempt a USDC-only exit with slippage protection.

---

## Trust boundary

We don't oversell what's verified on-chain vs off-chain. Here's the honest map.

### What the chain verifies (on every executeStrategy)

- **Caller is the registered agent** — `msg.sender == agent` (set at vault creation, owner-mutable).
- **Caller holds an active Agent INFT bound to the recovered TEE signer** — the vault recovers the signer from the compact signed response and checks `agentNFT.isActiveAgentWithSigner(msg.sender, teeSigner)`. Owner can revoke any time.
- **TEE signer signature over the response** — the vault verifies the EIP-191 signature over the compact public JSON response before swapping.
- **Intent freshness and replay protection** — each execution includes a deadline checked on-chain, and both the `intentHash` and signed `responseHash` are single-use.
- **Cooldown elapsed** — `block.timestamp ≥ lastExecutionTime + cooldownPeriod`.
- **Post-trade WETH exposure within policy** — risk-on actions revert if WETH value after the swap exceeds `maxAllocationBps` of TVL. Emergency deleverage is never blocked by the exposure cap.
- **Drawdown within policy** — post-trade TVL must remain within `maxDrawdownBps` of the high-water mark.
- **Oracle price is fresh** — `block.timestamp - oracleUpdatedAt ≤ maxPriceStaleness`.
- **Swap respects oracle slippage bound** — `minOut = expected × (1 − maxSlippageBps)`. Router reverts otherwise.
- **Vault is not paused or killed.**
- **Re-entrancy guarded.**

### What the chain DOES NOT verify (and why this is honest)

- **The full TEE attestation report is NOT cryptographically verified on-chain.** The agent verifies the 0G response off-chain with `broker.inference.processResponse(provider, chatID, content)` and the vault verifies the TEE signer signature over the compact JSON response on-chain. The on-chain check proves the response came from the INFT-bound TEE signer; the broader provider attestation and service verification remain off-chain and auditable.
- **The contract does not parse the signed JSON response.** The vault verifies the TEE signer, deadline, and single-use hashes on-chain, then stores the intent/response hashes for audit. The enriched audit page binds the signed response, reconstructed execution intent, transaction hash, and 0G Storage proof for human verification.
- **The off-chain decision is taken by the agent**, not by the contract. The contract enforces bounds; it does not compute the strategy. A malicious agent inside the bounded envelope can still pick the worst-of-allowed-actions, but it cannot exceed WETH exposure, drawdown, slippage, or cooldown.
- **The market price comes from centralised exchanges** (Binance, CoinGecko, Coinbase, Kraken — median of 4 sources, 2-of-4 quorum required). This is more robust than a single source but it is not a fully decentralised oracle. A coordinated manipulation across all four CEX feeds would be required to push a bad price.
- **The swap routes through `SentriPair`**, an in-protocol AMM seeded with `MockUSDC`/`MockWETH` for testnet reproducibility. v2 mainnet would integrate a real DEX (Jaine on 0G mainnet, or equivalent) with real liquidity.

### What this means for the user

A vault owner can reason about Sentri's safety along **two independent dimensions**:

1. **Bound** — what's the worst the agent can do within policy? This is fully on-chain and tight: bounded post-trade WETH exposure, bounded drawdown from peak, bounded slippage per swap, bounded cadence (cooldown). The owner sets the bounds at vault creation and can update them; the agent cannot.
2. **Recourse** — what happens if something goes wrong? `pause()` blocks all activity reversibly; `emergencyWithdraw()` returns 100% of base + risk assets to the owner irreversibly; `emergencyDeleverageAndWithdraw(minBaseOut)` attempts to swap all WETH to USDC first and reverts if the slippage guard cannot be met. All are owner-only and not gated by the agent or the price feed.

The TEE story is now split honestly: 0G response verification and provider attestation happen off-chain in the agent, while the vault checks the recovered TEE signer signature on-chain, rejects expired/replayed intents, and commits the intent hash for audit replay.

---

## What is intentionally out of scope

- **Active trading / perp strategies.** Sentri rebalances and risk-manages — it does not chase short-term alpha. The interesting privacy story is *which constraints the agent enforces in private*, not *which trades it places*.
- **Multiple risk assets.** v1 supports USDC ↔ WETH only. Multi-asset (WBTC, etc.) is a v2 conversation.
- **Multi-chain.** v1 targets 0G mainnet for review and Galileo for rehearsal. Cross-chain coordination is out of scope.
- **Agent marketplace / operator competition.** Single shared agent (us). Aegis Vault occupies that lane; we differentiate on focus.
- **Persistent memory across iterations.** Stateless by design — auditability first.
- **Smart contract audit.** Slither static analysis runs on every PR; a formal third-party audit is roadmapped pre-mainnet.

---

## Roadmap

- **v1 (now)**: Galileo rehearsal plus 0G mainnet review deployment. Multi-tenant factory, presets, in-app deploy wizard, per-vault audit.
- **v1.1**: Custom policy in the deploy wizard UI. Subgraph for aggregate analytics. Persistent KV cache (Upstash) so the agent server's audit cache survives redeploys.
- **v2**: Mainnet deployment. Multi-asset support. ERC-4626 vault shares for multi-LP support per vault. Operator pool with bonded stake (optional).
- **v3**: Cross-chain (Arbitrum first). Insurance pool. Formal audit.

---

## License

MIT — see [LICENSE](./LICENSE).
