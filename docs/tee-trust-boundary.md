# Sentri · TEE Trust Boundary

Sentri's threat model: **the agent proposes, the vault disposes.** The agent runs in a 0G Compute TEE and signs its responses; the vault enforces every policy and limit on-chain regardless of what the agent decides. The protocol's strength is what is verified on-chain, not the LLM's reasoning.

This page spells out — explicitly, with no overclaiming — what is verified at each layer.

## A. Verified ON-CHAIN (in the vault, every execution)

| Check | Implementation |
|---|---|
| Agent identity | Agent EOA must be an active operator (`AgentINFT.isActiveAgent`). |
| TEE signer binding | The signer recovered from the response signature is the active TEE signer bound to the AgentINFT (`AgentINFT.isActiveAgentWithSigner`). |
| Signature validity | EIP-191 ECDSA recovery on the canonical response payload. |
| Deadline | `intent.deadline` cannot be in the past. |
| Replay protection | `intentHash` is recorded and rejected on reuse. |
| Cooldown | Minimum spacing between executions (`policy.cooldownPeriod`). |
| Exposure cap | Post-trade risk allocation `≤ policy.maxAllocationBps`. |
| Drawdown cap | Post-trade drawdown `≤ policy.maxDrawdownBps`. |
| Oracle freshness — Standard | `SentriPriceFeed` staleness `≤ policy.maxPriceStaleness`. |
| Oracle freshness — Advanced | Pyth `publishTime` within `pythMaxAge = 60s`. |
| Pyth confidence — Advanced | Conf bps `≤ pythMaxConfBps = 200`. |
| Slippage | `minOut` enforced; effective slippage `≤ policy.maxSlippageBps`. |
| Pause / kill | `vault.killed = false`, `vault.paused = false`. |
| Reentrancy | OpenZeppelin `ReentrancyGuard` on `executeStrategy*`. |

## B. Verified OFF-CHAIN (broker + agent, anchored in 0G Storage audit blob)

| Check | Where it is recorded |
|---|---|
| 0G Compute broker `processResponse` succeeded (TEE provider signature verified by the broker) | `processResponseVerified: true` in the audit blob. |
| Signer match (agent verifies recovered signer == expected TEE signer from the broker before sending tx) | `signerMatchedProvider: true` in the audit blob. |
| Provider session | `chatID` (0G Compute) recorded in the audit blob. |
| Signed response payload (TeeML `pubkey:signature` pair) | `signedResponse` in the audit blob. |
| Reasoning, model response, market sources, intent/responseHash | All in the audit blob (schema `sentri.inference.v1`). |
| Storage anchor | `canonicalRootHash` (0G Storage root) + `canonicalStorageTxHash` (submission tx) exposed by the audit endpoint. |

The audit blob is written to 0G Storage **before** the on-chain tx. If the write fails, the tx is not sent. The blob is recoverable by any read-only client.

## C. NOT claimed (explicit limits)

- **No full TEE hardware attestation parsing on-chain.** The vault does not parse TDX/SGX quotes in Solidity, does not verify certificate chains on-chain, does not check PCR measurements on-chain. The TEE binding on-chain is **signer-based** (ECDSA against the AgentINFT-bound signer).
- **The LLM is not claimed to be trustless.** The model can choose any action *within the policy envelope*. It cannot exceed exposure cap, slippage, drawdown, cooldown, replay, or pause/kill — those are contract-enforced.
- **The contract does not "understand" the strategy.** The vault enforces numerical limits and identity binding; the reasoning text is recorded for audit, not executed.
- **No on-chain Jaine ↔ Pyth cross-check.** Standard tier uses 2-of-2 off-chain quorum (Jaine `slot0()` + Pyth Hermes). Advanced tier trusts the Pyth pull oracle as the single on-chain price source per execution, bounded by `pythMaxAge` and `pythMaxConfBps`.

## Why this boundary is intentional

If the TEE were compromised but the AgentINFT signer rotation policy held, the vault still enforces every numerical bound — a compromised TEE cannot exceed `maxAllocationBps`, cannot bypass slippage, cannot replay intents, cannot withdraw funds.

If the AgentINFT signer were rotated, the contract rejects signatures from the old signer immediately — no migration, no race.

A full on-chain attestation verifier would let the vault assert "this response was produced by a specific TDX measurement." It would not change what the agent is *allowed* to do — that's the policy envelope, and it's already enforced. Building it now would add complexity without changing the security boundary, so it is deliberately out of scope.

## Summary

The agent's role is to **propose** within the policy envelope.
The vault's role is to **enforce** the envelope cryptographically and economically.
The TEE is the layer that lets the protocol bind a signer to a sealed inference session without trusting the LLM — but the contract never depends on the TEE attestation itself; it depends on the AgentINFT-bound signer.

---
*See also: [`oracle-proof.md`](./oracle-proof.md) for the Pyth oracle path. Canonical mainnet execution: tx `0x45ab1a82…7317fa`.*
