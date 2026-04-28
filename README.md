# Sentri

**Verifiable financial logic for autonomous treasury management.**
Private strategy, verifiable results.

Sentri is an autonomous, risk-managed stablecoin treasury agent. It plans privately inside a TEE via **0G Sealed Inference**, executes through an on-chain policy engine that it cannot override, and publishes cryptographic proofs of every decision to **0G Storage** — without revealing the strategy itself.

Built for the **0G APAC Hackathon** — Track 2: *Agentic Trading Arena (Verifiable Finance)*. Sentri implements the track's core thesis — *fully autonomous, verifiable financial logic* — applied to the treasury / risk-management end of the spectrum, with **Sealed Inference and TEE-based execution** as the privacy primitive that makes proprietary strategies safe to run on-chain.

> Sentri is **not** an active trading bot. It is a *verifiable risk-managed allocator* — closer in spirit to a treasury fund than to a perp strategy. The agent's job is to keep the treasury within a declared risk envelope while remaining transparently provable, not to chase alpha.

---

## The problem

On-chain treasury management is either manual (slow, emotional) or bot-driven (public strategies, frontrunnable, no accountability). Neither option is acceptable for funds that need both autonomy and auditability — the exact profile of a DAO treasury, protocol reserve, or yield fund.

## The answer

A treasurer agent whose **reasoning runs inside a TEE**, whose **execution is gated by on-chain policy**, and whose **audit trail is cryptographically verifiable** — all without leaking the alpha.

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
| **Sealed Inference** | Every strategy decision is computed inside a TEE via the 0G compute broker. Attestation bytes are stored on-chain with each execution. |
| **Storage KV** | Live portfolio state, market snapshots, and agent heartbeat — readable by the dashboard. |
| **Storage Log** | Immutable audit trail. Every decision written with reasoning, proof hash, TX hash. |
| **Agent ID (INFT)** | `AgentINFT.sol` gates `executeStrategy()` — only an address holding an active agent NFT with a valid enclave measurement can execute. Soft kill via revocation. |

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

### Agent loop

1. Fetch ETH/USD spot from Binance (fallback CoinGecko).
2. Push the price to `SentriPriceFeed` (the agent is the sole keeper).
3. Pull current vault state (balances, high-water mark, policy).
4. Call Sealed Inference with a signed prompt containing market + portfolio snapshot. The TEE returns a JSON decision + attestation.
5. Hash the reasoning → `proofHash`. Store the full object in 0G Storage Log under that hash.
6. Call `TreasuryVault.executeStrategy(action, amountIn, proofHash, teeAttestation)`. The contract enforces: active agent INFT, policy compliance, cooldown, drawdown, slippage.
7. On success, the vault emits `StrategyExecuted` and appends to `executionLogs[]`.
8. Write agent heartbeat to 0G Storage KV. Cooldown. Repeat.

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
pnpm --filter @sentri/web dev
```

Open http://localhost:3000. Connect a wallet on Galileo, mint testnet USDC from the vault page, deposit, and watch the agent operate.

### Agent runtime

```bash
pnpm --filter @sentri/sdk setup-broker   # one-time: register with the 0G compute broker
pnpm --filter @sentri/sdk agent          # start the autonomous loop
```

The agent will fetch market data, run TEE inference, execute on-chain, and stream heartbeats to the dashboard.

---

## Deployed addresses

| Contract | Address | Explorer |
|---|---|---|
| `TreasuryVault` | `TBD` | https://chainscan-galileo.0g.ai |
| `AgentINFT` | `TBD` | https://chainscan-galileo.0g.ai |
| `SentriSwapRouter` | `TBD` | https://chainscan-galileo.0g.ai |
| `SentriPair` | `TBD` | https://chainscan-galileo.0g.ai |
| `SentriPriceFeed` | `TBD` | https://chainscan-galileo.0g.ai |
| `MockUSDC` | `TBD` | https://chainscan-galileo.0g.ai |
| `MockWETH` | `TBD` | https://chainscan-galileo.0g.ai |

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
