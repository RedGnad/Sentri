# Sentri

**Verifiable autonomous treasury for stablecoin reserves.**
Private strategy, verifiable results.

Sentri is a verifiable autonomous treasury agent. The vault holds **USDC as the home asset**; the agent has bounded discretion (max 30% of TVL) to deploy WETH for productive risk exposure when market conditions are constructive — privately analyzed in a TEE via **0G Sealed Inference**, executed under on-chain policy it cannot override, and audited via **0G Storage**.

Built for **DAOs, protocol reserves, and foundations** that hold stablecoin reserves but want intelligent — and verifiable — productive deployment, without trusting a black-box trader. Submitted to the **0G APAC Hackathon** — Track 2: *Agentic Trading Arena (Verifiable Finance)*. Sentri implements the track's core thesis — *fully autonomous, verifiable financial logic* — applied to the **autonomous treasury** category, with **Sealed Inference and TEE-based execution** as the privacy primitive that makes proprietary risk policies safe to run on-chain.

> Sentri is **not** a trading bot. It is a *stables-first verifiable treasury* with a kill-switch that returns 100% to USDC instantly. The agent's job is to keep reserves productive within a declared envelope, not to chase alpha.

---

## The problem

DAOs, protocols, and foundations hold **$26B+ in on-chain stablecoin reserves** that mostly sit idle. Putting that capital to work has two existing options, both bad:

- **Manual deployment** — slow, emotional, expensive in attention; treasurers freeze on volatility.
- **Bot-driven yield farming** — public strategies, frontrunnable, opaque about how decisions are made, no recourse when they misbehave.

Neither is acceptable for a treasury that needs **both autonomy and auditability** — capital preservation as the floor, productivity as the upside, transparency as the contract.

## The answer

A treasury agent whose **reasoning runs inside a TEE**, whose **execution is gated by on-chain policy**, and whose **audit trail is cryptographically verifiable** — all without leaking the strategy.

```
┌──────────────┐   ┌───────────────────┐   ┌──────────────┐   ┌────────────┐   ┌──────────────┐
│ Market data  │ → │ Sealed Inference  │ → │ Policy check │ → │ On-chain   │ → │ 0G Storage   │
│ (ETH/USD)    │   │ TEE (0G Compute)  │   │ (on-chain)   │   │ swap       │   │ audit trail  │
└──────────────┘   └───────────────────┘   └──────────────┘   └────────────┘   └──────────────┘
                          private                public             real            verifiable
```

The agent has **no authority to override its constraints**. Max allocation, max drawdown, cooldowns, slippage bounds and the kill-switch all live in the vault contract. The agent proposes, the contract disposes.

---

## 0G components used (5/6)

| Component | Usage |
|---|---|
| **Chain** | `TreasuryVault.sol` deployed on Galileo (chain ID 16602) — funds, policy engine, execution gate, kill-switch. |
| **Sealed Inference** | Every strategy decision is computed inside a TEE via the 0G compute broker. The keccak256 hash of the chat ID + provider + verification status (the **TEE attestation hash**) and the keccak256 of the prompt + response (the **proof hash**) are both written into the on-chain `executionLogs[]` for every execution. The raw attestation payload is stored alongside in 0G Storage. |
| **Storage KV** | Live portfolio snapshot (TVL, balances, last action, total executions, P&L) — written after every successful execution. The dashboard reads it via the agent server's `/state` endpoint. |
| **Storage Log** | Immutable audit trail. Every decision written with reasoning, confidence, market context, proof hash, on-chain TX hash and 0G Storage TX hash. |
| **Agent ID (INFT)** | `AgentINFT.sol` gates `executeStrategy()`. The vault checks **both** that `msg.sender` is the registered `agent` address **and** that this address holds an active (non-revoked) Agent INFT with a valid enclave measurement. Owner can revoke the INFT to halt the agent without burning the token (soft kill). |

The 6th component (Persistent Memory) is intentionally not used — it would exceed scope for a 3-minute demo.

---

## Architecture

```
contracts/                Foundry project (Solidity 0.8.24, OpenZeppelin v5)
  src/
    TreasuryVault.sol     Core vault — funds, policy, execution, audit log
    AgentINFT.sol         On-chain agent identity (enclave measurement + attestation)
    SentriSwapRouter.sol  Uniswap v2-style router (single-pair, 0.3% fee)
    SentriPair.sol        Constant-product AMM (USDC ↔ WETH)
    SentriPriceFeed.sol   AggregatorV3-compatible oracle, pushed by the agent
    MockUSDC.sol          6-dec stablecoin with public mint (testnet)
    MockWETH.sol          18-dec risk asset with public mint (testnet)

packages/sdk/             TypeScript agent runtime
  src/
    agent.ts              Main loop: fetch → infer → policy → execute → log
    inference.ts          0G Sealed Inference client (TEE attestation)
    market.ts             ETH/USD oracle (Binance / CoinGecko)
    storage.ts            0G Storage KV + Log writer
    setup-broker.ts       One-shot provider registration for the compute broker

apps/web/                 Next.js 14 dashboard (App Router, wagmi v2, viem)
  src/app/
    page.tsx              Landing
    vault/                TVL, allocation, P&L, deposit/withdraw, agent status
    audit/                Full execution trail with proof hash + TEE attestation
    policy/               Risk parameter display and update (owner only)
    emergency/            Kill-switch and pause/unpause
    api/                  Server routes for agent-status and audit enrichment
```

### Agent loop (`packages/sdk/src/agent.ts`, `executeOneIteration`)

1. **Fetch market** — ETH/USD spot from Binance (CoinGecko as fallback).
2. **Push price on-chain** — agent is the sole keeper of `SentriPriceFeed`. The push doubles as a freshness signal: the vault rejects swaps if the oracle is older than `maxPriceStaleness`.
3. **Read vault state** — balances, high-water mark, policy parameters, execution log count.
4. **Build prompt** — structured market + portfolio + policy snapshot.
5. **Sealed Inference** — request analysis through the 0G compute broker; the response is signed by the TEE. We compute `proofHash = keccak256(prompt + response + chatID + ts)` and `teeAttestation = keccak256(chatID + provider + verified)`.
6. **Size the order** — apply `amount_bps` to the relevant balance (USDC for Rebalance/YieldFarm, WETH for EmergencyDeleverage), capped locally to `maxAllocationBps × TVL`.
7. **Execute on-chain** — `vault.executeStrategy(action, amountIn, proofHash, teeAttestation)`. The contract enforces dual INFT gate, cooldown, allocation, drawdown, oracle freshness and per-swap slippage. Skips emit a log line and continue.
8. **Append audit entry to 0G Storage Log** — full reasoning, confidence, proof hashes, TX hash, market context. Cached locally and mirrored to 0G Storage.
9. **Write portfolio snapshot to 0G Storage KV** — for the dashboard's live view. Cooldown, then repeat.

### Risk policy (enforced on-chain)

- `maxAllocationBps` — max % of TVL allocated to the risk asset
- `maxDrawdownBps` — max drawdown from the high-water mark before strategy is frozen
- `rebalanceThresholdBps` — minimum deviation before a rebalance is allowed
- `maxSlippageBps` — slippage ceiling on swaps (checked against `SentriPriceFeed`)
- `cooldownPeriod` — minimum seconds between two executions
- `maxPriceStaleness` — oracle price must be fresher than this

The contract owner (not the agent) sets the policy. The kill-switch lives on the owner. The agent can read, propose and execute, never override.

---

## Getting started

### Prerequisites
- Node ≥ 20, pnpm ≥ 9
- Foundry (for contracts)
- A wallet with a tiny bit of Galileo testnet OG (faucet: https://faucet.0g.ai)

### Install

```bash
pnpm install
```

### Contracts

```bash
cd contracts
forge build
forge test
```

### Deploy to Galileo

```bash
cp .env.example .env          # fill PRIVATE_KEY
forge script script/Deploy.s.sol \
  --rpc-url https://evmrpc-testnet.0g.ai \
  --broadcast
```

Copy the deployed addresses into `apps/web/.env.local`:

```env
NEXT_PUBLIC_CHAIN_ID=16602
NEXT_PUBLIC_RPC_URL=https://evmrpc-testnet.0g.ai
NEXT_PUBLIC_EXPLORER_URL=https://chainscan-galileo.0g.ai
NEXT_PUBLIC_TREASURY_VAULT_ADDRESS=0x...
NEXT_PUBLIC_MOCK_USDC_ADDRESS=0x...
NEXT_PUBLIC_MOCK_WETH_ADDRESS=0x...
NEXT_PUBLIC_PRICE_FEED_ADDRESS=0x...
```

### Dashboard

```bash
pnpm dev               # alias for `pnpm --filter web dev`
```

Open http://localhost:3000. Connect a wallet on Galileo, mint testnet USDC from the vault page, deposit, and watch the agent operate. Set `AGENT_URL` in `apps/web/.env.local` to point at the running agent server (defaults to local cache fallback for dev).

### Agent runtime

The agent reads its config from `packages/sdk/.env` (see `.env.example`). Required: `PRIVATE_KEY` (a wallet with at least 3 OG on Galileo + held by an active Agent INFT and registered as keeper on `SentriPriceFeed`).

```bash
# One-time: register the wallet with the 0G compute broker, create a 3 OG ledger,
# and discover available inference services. Idempotent.
pnpm --filter @steward/sdk setup-broker

# Standalone CLI loop — runs forever in the foreground.
pnpm agent             # alias for `pnpm --filter @steward/sdk agent`

# Long-running HTTP server — same loop driven by setInterval, plus
# /healthz, /state, /audit endpoints for the dashboard. This is what
# render.yaml deploys.
pnpm --filter @steward/sdk run server
```

The agent will fetch market data, push the price on-chain, run TEE inference, execute through the swap router, and write the audit trail + portfolio state to 0G Storage on every iteration.

---

## Deployed addresses

All contracts live on **0G Galileo Testnet** (chain ID `16602`). Deployer: [`0x7531…dbd8`](https://chainscan-galileo.0g.ai/address/0x7531d467f19d1055accf6b0d22286184f87adbd8).

| Contract | Address |
|---|---|
| `TreasuryVault` | [`0x286dc3f6b3223053e49665333e11f21cfffb4a5e`](https://chainscan-galileo.0g.ai/address/0x286dc3f6b3223053e49665333e11f21cfffb4a5e) |
| `AgentINFT` | [`0x0e7e5f1d1b76727428352669c469d6e55d47fc81`](https://chainscan-galileo.0g.ai/address/0x0e7e5f1d1b76727428352669c469d6e55d47fc81) |
| `SentriSwapRouter` | [`0x93fd20a13dfcfc129f49d9d04ff8d4fb0a808c17`](https://chainscan-galileo.0g.ai/address/0x93fd20a13dfcfc129f49d9d04ff8d4fb0a808c17) |
| `SentriPair` | [`0x325afae53695798f6110305e998742687e636e9a`](https://chainscan-galileo.0g.ai/address/0x325afae53695798f6110305e998742687e636e9a) |
| `SentriPriceFeed` | [`0xc9d99f3c3de46d3fd816f0b08dd48b4fba41a711`](https://chainscan-galileo.0g.ai/address/0xc9d99f3c3de46d3fd816f0b08dd48b4fba41a711) |
| `MockUSDC` | [`0xd23cd7730595486d234e50bb7c97e351860a9add`](https://chainscan-galileo.0g.ai/address/0xd23cd7730595486d234e50bb7c97e351860a9add) |
| `MockWETH` | [`0xad67a837b2662118f077ff404827cc82f61d5ccb`](https://chainscan-galileo.0g.ai/address/0xad67a837b2662118f077ff404827cc82f61d5ccb) |

---

## Demo

Three-minute video walkthrough: **TBD**

The demo covers one full closed loop:

1. Connect wallet, mint testnet USDC, deposit into the vault.
2. Agent fetches market data and runs Sealed Inference.
3. Policy check on-chain; swap executes through the router.
4. Audit page shows the decision with proof hash and TEE attestation.
5. Kill-switch pulls all funds back to the owner.

---

## What is intentionally out of scope

- **Active trading / perp strategies.** Sentri rebalances and risk-manages — it does not chase short-term alpha. The interesting privacy story is *which constraints the agent enforces in private*, not *which trades it places*.
- **Multiple strategies.** One closed loop, done well, beats a marketplace of half-finished bots.
- **Persistent memory.** Every iteration is stateless by design — auditability first.
- **Mainnet liquidity.** The mini-DEX (`SentriPair` / `SentriSwapRouter`) exists to make execution *real*, not to compete with Uniswap. It lets the vault actually move value so slippage, TVL impact, and drawdown are measurable on-chain.
- **Agent marketplace / INFT trading.** The INFT is a functional identity gate, not a collectible.

---

## License

MIT — see [LICENSE](./LICENSE).
