# Slippage backoff (agent-side soft circuit breaker)

**Framing:** graceful degradation under temporary liquidity/slippage constraints.
Not an "optimization" — a maturity guard that keeps the agent and audit trail
clean when the pool cannot be entered within the vault's risk-defined slippage.

> This mitigates retry churn under temporary pool/slippage constraints; it does
> **NOT** solve the underlying on-chain fee/slippage budget tension.

## Problem

A risk buy (`Rebalance`, base→risk) computes `minOut` from the oracle price and
`policy.maxSlippageBps`. The AMM also charges a fixed swap fee (0.3% on the live
0G pool). When `fee + (pool↔oracle spread) > maxSlippageBps`, the swap reverts
on-chain with `InsufficientAmountOut` — safely, no funds moved. On the tight
Conservative preset (50 bps), the 0.3% fee alone leaves ~0.2% of real headroom,
so the same buy reverts every 5-minute cycle. Each cycle still spent a Sealed
Inference (TEE) call and appended an identical "blocked action" to the audit
trail. That is the churn this guard removes.

This is a **liquidity/slippage constraint**, not a bug: the on-chain slippage
guard is doing its job.

## What the guard does

Pure orchestration layer. **No contract / policy / slippage / threshold change.
The persist → verify → execute path is untouched.**

- **Arm** (`recordSlippageBackoff`): only on the **exact** `InsufficientAmountOut`
  revert — matched by name string *and* by decoded 4-byte selector
  (`InsufficientAmountOut()`). No oracle / TEE / auth / replay / kill / generic
  revert can arm it.
- **Hold** (pre-LLM gate): while armed, a buy recommendation is skipped *before*
  Sealed Inference — no TEE call, no tx, no new rejection-ledger entry. The first
  revert is still logged honestly; only the redundant retries are suppressed.
- **Clear** (`clearSlippageBackoff`): the moment any execution confirms (the pool
  is back within range).
- **Bypass**: safety regimes (`drawdown_breach`, `crash`) skip the gate, and only
  the **buy** direction is gated — every defensive exit / unwind
  (`EmergencyDeleverage`) is never delayed.
- **Scope**: state is keyed per vault (`Map<vaultAddressLower, { until }>`), never
  global. Process-local; a restart costs at most one extra retry.

## Tuning

`SLIPPAGE_BACKOFF_SEC` (env, default `1800` = 30 min). With 5-min cycles a stuck
buy drops from ~12 reverts/h to ~2/h.

## Observability

Grep `[slippage-backoff]` in the agent logs:

- `set vault=… expiry=… reason=InsufficientAmountOut`
- `skip vault=… remaining=Ns`
- `clear vault=… — execution confirmed`

## Out of scope (contract-level, intentionally untouched)

The fixed pool fee being consumed inside `policy.maxSlippageBps` is the root
tension. Fixing it (e.g. accounting for the deterministic fee separately, or a
preset floor) is a contract change and belongs to a later iteration — tracked
alongside the V2 decentralized Pyth vaults.
