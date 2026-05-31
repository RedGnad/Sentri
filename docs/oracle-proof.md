# Sentri · Oracle Path Verification

A one-page reference for Sentri's dual oracle architecture: the Standard tier (keeper-pushed quorum) and the Advanced tier (Pyth pull oracle verified on-chain in the same transaction as the swap).

## Dual oracle architecture

### Standard tier (default, live)
Every cycle reads Jaine V3 `slot0()` on-chain plus Pyth `0G/USD` via Hermes (2-of-2 quorum, spread-bounded), then a keeper pushes the verified median to `SentriPriceFeed`. The vault enforces oracle freshness, slippage, exposure, drawdown, replay, cooldown, and pause/kill before any swap.

### Advanced tier — Trustless Oracle Vault (live, opt-in)
Each `executeStrategyWithPyth()` carries a signed Pyth update **verified on-chain in the same transaction as the swap**. The verified Pyth price drives `minOut`, exposure, drawdown and TVL. No keeper-pushed step. Per-execution Pyth update fee (0.2 OG on 0G mainnet today) makes this tier **opt-in per vault** — Standard remains the default for tiny vaults that can't amortize the fee.

Bounds: `pythMaxAge = 60s`, `pythMaxConfBps = 200`.

## 0G mainnet addresses (chain id `16661`)

| Component | Address |
|---|---|
| `VaultFactoryV2` | [`0xA3588d1964F7CeCDcFac15e38D286554955CF58C`](https://chainscan.0g.ai/address/0xA3588d1964F7CeCDcFac15e38D286554955CF58C) |
| `TreasuryVaultTrustlessOracle` impl | [`0x0F8b9A0c064306F938912658c96c681D8655140B`](https://chainscan.0g.ai/address/0x0F8b9A0c064306F938912658c96c681D8655140B) |
| Reference V2 vault (Balanced) | [`0x86cE22c597D0C4EC309ba166360686C39A3f40ed`](https://chainscan.0g.ai/address/0x86cE22c597D0C4EC309ba166360686C39A3f40ed) |
| Pyth oracle (0G mainnet) | [`0x2880aB155794e7179c9eE2e38200202908C17B43`](https://chainscan.0g.ai/address/0x2880aB155794e7179c9eE2e38200202908C17B43) |
| Pyth feed `Crypto.0G/USD` | `0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070` |

## Canonical executeStrategyWithPyth tx (mainnet)

[`0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa`](https://chainscan.0g.ai/tx/0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa)

| Field | Value |
|---|---|
| Action | `Rebalance` |
| amountIn | `318600` raw (`0.3186 USDC.E`) |
| amountOut | `746805700932788353` raw (`0.7468 W0G`) |
| Pyth price | `42406745` (`0.42406745 USD`) |
| Pyth confidence | `22 bps` (bound: `≤ 200 bps`) |
| Pyth freshness | `9 s` (bound: `≤ 60 s`) |
| Pyth publishTime | `1780029724` (`2026-05-29T04:42:04Z`) |
| executionLogCount | `0 → 1` |
| TEE signer (recovered) | `0x0038F716958A90b753DA6937787395E2365DB2e8` (bound to AgentINFT) |

## Verify it yourself (read-only, no keys)

```bash
pnpm install
pnpm --filter @steward/sdk verify:summary -- \
  --tx 0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa
```

Expected output: 9/9 underlying checks PASS, then a summary box ending with `VERDICT: PASS`. `verify:summary` wraps `verify:trustless-execution` (Pyth + TEE signer + policy + explorer) and prints the off-chain 0G Storage anchors (root + storage tx + indexer URL) for the audit blob. Read-only — no key, no broker.

## What is proven

1. The tx is a successful `executeStrategyWithPyth` on the Reference V2 vault.
2. A signed Pyth update was verified on-chain inside the same transaction.
3. The verified Pyth price drove `minOut`; freshness and confidence are within the policy bounds.
4. The TEE signer recovered from the response signature is bound to the active AgentINFT (via `isActiveAgentWithSigner`).
5. Replay protection, deadline, slippage, exposure, drawdown, cooldown, pause/kill — all enforced by the vault before the swap can fire.

## What is NOT claimed

- **No full TEE hardware attestation parsing on-chain.** TEE binding on-chain is signer-based (ECDSA against the AgentINFT-bound signer). See [`tee-trust-boundary.md`](./tee-trust-boundary.md).
- **No on-chain Jaine ↔ Pyth cross-check.** The Advanced tier trusts the Pyth pull oracle as the single on-chain price source for that execution (bounded by `pythMaxAge` and `pythMaxConfBps`). Standard tier uses a 2-of-2 off-chain quorum.

## Why opt-in, not default

Pyth update fee on 0G mainnet is `0.2 OG` per execution today — uneconomic for very small vaults. Selecting the Advanced tier is a per-vault choice at deploy time. Both paths are verifiable on-chain; both enforce the same risk envelope.

---
*Last verified against tx `0x45ab…7317fa` on `2026-05-29` (chain id `16661`).*
