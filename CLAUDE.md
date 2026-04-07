# Steward — Autonomous Treasury Execution on 0G

## What is this
Autonomous stablecoin treasury agent. Plans privately in TEE (Sealed Inference), executes according to on-chain risk policies, publishes verifiable proofs without revealing strategy.

**Hackathon**: 0G APAC Hackathon | **Deadline**: 9 mai 2026 | **Prize**: $150K
**Track**: Track 2 (Agentic Trading Arena / Verifiable Finance)
**Pitch**: "Your AI treasurer — private strategy, verifiable results."

## Chain
- 0G Galileo testnet — EVM, chain ID 16602
- RPC: https://evmrpc-testnet.0g.ai
- Explorer: https://chainscan-galileo.0g.ai
- Faucet: 0.1 OG/jour/wallet

## Stack
- Contracts: Solidity 0.8.24, Foundry, OpenZeppelin v5
- Frontend: Next.js 14 App Router, TypeScript, Tailwind, shadcn/ui, wagmi v2, viem, RainbowKit
- 0G SDKs: @0glabs/0g-serving-broker (Sealed Inference), @0gfoundation/0g-ts-sdk (Storage)

## Monorepo
```
contracts/         — Foundry (TreasuryVault, MockUSDC)
packages/sdk/      — 0G integration (inference, storage, agent runtime)
apps/web/          — Next.js dashboard
```

## 0G Components (5/6)
1. **Chain** — TreasuryVault contract (funds + policy engine + kill-switch)
2. **Compute / Sealed Inference** — Private strategy planning in TEE with attestation
3. **Storage KV** — Market snapshots, portfolio state, reports
4. **Storage Log** — Immutable audit trail (decisions + proofs)
5. **Agent ID / INFT** — Agent identity, only if it strengthens product (not decorative)

## Contracts

**TreasuryVault.sol** (core):
- deposit/withdraw MockUSDC
- executeStrategy(action, proofHash, teeAttestation) — must conform to policy
- Policy: maxAllocationBps, maxDrawdownBps, rebalanceThresholdBps, cooldownPeriod
- emergencyWithdraw() — kill-switch
- pause/unpause — circuit breaker
- On-chain audit log: every execution with timestamp + proofHash + attestation

**MockUSDC.sol**: ERC20, 6 decimals, public mint for testnet

## Agent Loop
1. Fetch market data → 2. Sealed Inference (private analysis) → 3. Check policy → 4. Execute on-chain → 5. Store audit in 0G Storage Log → 6. Update state in Storage KV → 7. Cooldown → repeat

## Dashboard Pages
- `/` — Landing + pitch
- `/vault` — Balance, allocation, P&L, agent status
- `/audit` — Full trail with proofHash + TEE attestation per decision
- `/policy` — Risk parameter config form
- `/emergency` — Kill-switch + pause/unpause

## DO NOT
- Use Persistent Memory (marked "coming soon")
- Use OpenClaw as product (Ghast AI does this)
- Use marketplace framing (AIverse does this)
- Build 100 strategies — ONE closed loop, complete and polished
- Add incomplete features — less but working > more but broken
- Add INFT just for decoration

## Scope
One closed loop demonstrated in 3 min:
deposit → private analysis (TEE) → policy-compliant decision → execution → verifiable proof → audit trail → kill-switch

## Env vars
```
NEXT_PUBLIC_CHAIN_ID=16602
NEXT_PUBLIC_RPC_URL=https://evmrpc-testnet.0g.ai
NEXT_PUBLIC_EXPLORER_URL=https://chainscan-galileo.0g.ai
PRIVATE_KEY=         # deployer (NEVER commit)
OG_STORAGE_URL=https://storage-testnet.0g.ai
OG_COMPUTE_URL=https://compute-testnet.0g.ai
```

## Conventions
- TypeScript strict, Solidity NatSpec on public functions
- Prettier (TS), forge fmt (Solidity)
- Server components default, "use client" only when needed
- TanStack Query (server state), zustand (client state)
- Conventional commits (feat:, fix:, chore:)

## Submission
- Contract on Galileo testnet + explorer link
- Video demo ≤ 3 min
- README with setup + architecture + 0G components
- Public repo with progression during hackathon
- Post X: #0GHackathon #BuildOn0G @0G_labs
