# Runbook — P4: canonical `executeStrategyWithPyth()` proof on the canary

Goal: produce **one** judge-verifiable trustless execution on the canary vault
`0x86cE22c597D0C4EC309ba166360686C39A3f40ed` (0G mainnet), then verify it.

This is the only step that requires the agent key. Everything here is designed so
your sensitive action is a single, gated command.

## Security rules (non-negotiable)

- Run **only** on the secure box where the agent key (`0x981F…`) and the 0G
  compute broker already live. Never on an untrusted machine.
- `PRIVATE_KEY` comes from a local `.env` **only** — never hardcoded, never
  committed, never echoed. `.env*` is gitignored.
- The live agent never touches the canary: `discoverVaults` reads the standard
  factory, not `VaultFactoryV2`, so this is isolated by construction.

## Prerequisites

- Branch `feature/trustless-oracle-vault` (has the V2 agent + these scripts).
- `.env` with `PRIVATE_KEY=0x<agent key>` and `RPC_URL=https://evmrpc.0g.ai`.
- Agent wallet funded: ~0.2 OG Pyth fee + gas per execution (it has ~7.6 OG).

## Step 1 — Fund the canary vault (minimal)

The canary is empty (pre-flight reports `0.0 / 0.0`). Deposit a **minimal** amount
of `USDC.E` as the vault owner (`0x79C5…`) — enough for one small Rebalance buy.
Keep it small: the goal is a verifiable proof, not size. (Owner action; via the
dashboard deposit flow or a direct `deposit` call.)

## Step 2 — SIMULATE (read-only gate, no key needed to read)

```bash
pnpm --filter @steward/sdk preflight:trustless-execution
```

Must be all green: agent authorized, cooldown elapsed, vault has tradeable
balance, Hermes 0G/USD update data non-empty, confidence ≤ 200 bps, agent OG
covers fee + gas. If any blocker, fix it before sending.

A dry context check (validates broker + signer-health, requests no inference,
sends nothing):

```bash
ORACLE_MODE=trustless-pyth pnpm --filter @steward/sdk execute:trustless-canary
```

## Step 3 — SEND (the single sensitive command)

```bash
ORACLE_MODE=trustless-pyth pnpm --filter @steward/sdk execute:trustless-canary -- --send
```

This requests sealed inference, fetches the Pyth 0G/USD update from Hermes, and
calls `executeStrategyWithPyth()` on the canary. Expected cost ≈ **0.2 OG Pyth
fee + gas**. The vault re-verifies Pyth freshness/confidence + slippage on-chain
in the same tx; a swap that cannot clear slippage **reverts safely (no funds
moved)** — that is not a failure of the proof, it is the guard working.

On success the script prints the tx hash and the verify command.

## Step 4 — VERIFY (read-only, judge-shareable)

```bash
pnpm --filter @steward/sdk verify:trustless-execution -- --tx <hash>
```

Confirms: `TrustlessOracleExecution` emitted by the canary, agent matches, log
incremented, Pyth freshness ≤ 60 s, confidence ≤ 200 bps, recovered TEE signer
bound to the AgentINFT — and prints intentHash, responseHash, signer, pythPrice,
pythPublishTime, pythConfBps, amountIn, amountOut.

## Fallback — expected-revert proof (if a clean economic execution can't clear)

A successful swap is preferred, but a cleanly-documented **expected revert** is
still a valid proof of the on-chain guard. Each is the same `--send` command with
one condition deliberately off:

| Proof | How to induce | Expected on-chain error |
|---|---|---|
| Stale price | submit an old Pyth update (publishTime > 60 s) | `PythPriceStale` |
| Empty update data | pass empty `pythUpdateData` | `PythUpdateDataEmpty` |
| Confidence too wide | execute when Hermes conf > 200 bps | `PythConfidenceTooWide` |
| Unauthorized agent | call from a non-agent wallet | `AgentNotAuthorizedForVault` |
| Replayed intent | reuse a spent `intentHash` | `IntentAlreadyUsed` |
| Cooldown | execute twice within the cooldown window | `CooldownNotElapsed` |

Document the chosen revert tx the same way (tx hash + which guard fired).

## Status — PROVEN on 0G mainnet (2026-05-29)

Canonical execution: **`0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa`**
(https://chainscan.0g.ai/tx/0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa).
`executeStrategyWithPyth` Rebalance 0.3186 USDC.E → 0.7468 W0G; Pyth `0G/USD`
verified on-chain in the same tx (price 0.42406745, 22 bps conf, 9 s fresh);
`executionLogCount` 0 → 1. `verify:trustless-execution --tx <that hash>` passes
all checks. The trustless oracle execution path is now end-to-end verified.
