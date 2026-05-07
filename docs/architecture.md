# Architecture

This document covers the Sentri internals at the level a contributor or auditor would need: the monorepo layout, the per-cycle agent loop, the strategy doctrine, the defensive-verifier contract, and the full trust boundary. The README focuses on what Sentri *is* and how to *use* it. This document focuses on how it *works*.

---

## Monorepo layout

```
contracts/                       Foundry project (Solidity 0.8.24, OpenZeppelin v5)
  src/
    VaultFactory.sol              EIP-1167 clone factory + presets + per-owner registry
    TreasuryVault.sol             Per-user clone (init pattern). Funds, policy, execution, audit log
    AgentINFT.sol                 Shared agent identity (enclave measurement + revocation)
    SentriSwapRouter.sol          Uniswap v2-style router (single-pair, 0.3% fee) for Galileo
    JaineV3PoolAdapter.sol        Mainnet adapter for the Jaine USDC.E/W0G V3 pool
    SentriPair.sol                Constant-product AMM (MockUSDC ↔ MockWETH on Galileo)
    SentriPriceFeed.sol           AggregatorV3-compatible oracle, keeper-pushed by the agent
    MockUSDC.sol                  6-dec stablecoin with public mint (testnet)
    MockWETH.sol                  18-dec risk asset with public mint (testnet)
  test/
    TreasuryVault.t.sol           27 tests (init pattern, deposit/withdraw, strategy, HWM)
    VaultFactory.t.sol            21 tests (presets, custom policy, registry, atomic deposit)
    MultiVault.t.sol              13 tests (multi-vault isolation, agent across owners)
    AgentINFT.t.sol               12 tests (mint, revoke, O(k) gas scaling)
    SentriPair.t.sol              8 tests (swap, K invariant, slippage)
    JaineV3PoolAdapter.t.sol      5 tests (callback validation, path safety)
                                  Total: 86 unit + integration tests, 0 failing

packages/sdk/                    TypeScript multi-vault agent runtime
  src/
    agent.ts                      setupGlobalContext + discoverVaults + executeOneIterationForVault
                                  + runMultiVaultLoop. Per-cycle: push price once, iterate every vault
                                  with try/catch isolation. Hosts the deterministic strategy engine
                                  (classifyRegime, targetShareForRegime, computeStrategy) and the
                                  validateAgainstRecommendation defensive verifier.
    server.ts                     Express HTTP wrapper. Endpoints:
                                    GET /healthz                  global cycle counters + per-vault summary
                                    GET /vaults                   all known vaults + cached state
                                    GET /vault/:addr/state        per-vault portfolio snapshot
                                    GET /vault/:addr/audit        per-vault recent audit entries
                                    GET /vault/:addr/audit/:ts    single entry with ±5s tolerant lookup
                                  Each endpoint falls back to direct on-chain reads of executionLogs
                                  when the local cache is empty (e.g. after a service restart).
    storage.ts                    0G Storage KV writers, namespaced per vault address. Local cache
                                  mirror at /tmp/sentri-cache/vaults/{addr}/.
    inference.ts                  0G Sealed Inference client. Fail-closed unless processResponse()
                                  returns true; recovers the TEE signer from the provider signed
                                  chat payload via ethers.verifyMessage.
    market.ts                     Risk/USD oracle. Galileo: 4-CEX median (Binance, CoinGecko,
                                  Coinbase, Kraken). Mainnet: Jaine slot0() on-chain + Pyth Hermes
                                  0G/USD, 2-of-2 quorum, spread-bounded.
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

---

## Agent cycle

`packages/sdk/src/agent.ts` exports `runMultiVaultLoop` which executes this sequence at every interval (configurable per deployment):

1. **Push price on-chain** — fetch the risk/base market price, then push the median to `SentriPriceFeed`. Galileo rehearsal uses ETH/USD for `MockWETH`; 0G mainnet uses W0G/USDC.E through the configured market sources. The agent is the sole keeper.
2. **Discover vaults** — call `factory.allVaults()` to pick up any newly-created vaults this cycle.
3. **For each vault** (with per-vault failure isolation):
   - Read state (balances, HWM, policy, execution count).
   - Build a prompt with **deterministically pre-computed metrics** (risk-asset share, deviation from target, drawdown, regime label, recommended action and amount in bps). The LLM never does float math — it pattern-matches against the rule branches in its system prompt.
   - **Sealed Inference**: send to a verifiable TeeML provider, require `processResponse(...) === true`, fetch the chat signature, and recover the TEE signer.
   - **Defensive verifier**: run `validateAgainstRecommendation()` on the LLM output. Reject any override that is more aggressive than the matrix recommendation; skip the cycle with a logged reason if the contract is violated.
   - **Size + execute**: build a canonical `ExecutionIntent`, pass `intentHash`, the provider signed chat payload, the TEE signature, the attestation hash, and a deadline to `vault.executeStrategy(...)`. Skips emit a structured outcome and continue to the next vault.
   - **Audit + state** to 0G Storage KV, namespaced by vault address. Audit keys include vault + tx hash + log index + intent hash so entries do not collide.

---

## Strategy doctrine — vol-adjusted regime-aware target

Sentri's strategy is *vol-targeting*: instead of one fixed allocation goal, the target risk-asset share moves with the regime so exposure shrinks when the regime is stressed and expands when the regime is calm and constructive. This matches the institutional pattern referenced as 2026 best practice for AI-managed crypto treasuries (volatility forecasting → dynamic position sizing → drawdown control).

Three live signals classify the regime — all already known to the agent without any extra fetch:

- **`drawdown_from_HWM`** — capital preservation
- **24h price change** — directional momentum
- **oracle spread** — Pyth vs Jaine on-chain disagreement, used as a regime-stress proxy (wide spread = unsettled regime)

The matrix is computed deterministically in TypeScript before the LLM call:

| Regime | Trigger | Target share (Bal / Aggr) |
|---|---|---|
| `drawdown_breach` | drawdown ≥ 1.5% | 0% — full deleverage |
| `crash` | 24h ≤ −3% | 0% — full deleverage |
| `down_wide` | 24h ≤ −1% AND spread ≥ 1% | 10% — defensive lean |
| `down_tight` | 24h ≤ −1% AND spread < 1% | 18% — soft lean |
| `flat` | −1% < 24h < +1% | 22% — neutral, slight under-target |
| `up_wide` | 24h ≥ +1% AND spread ≥ 1% | 20% — tempered enthusiasm |
| `up_tight` | 24h ≥ +1% AND spread < 1% | 25% Balanced / **28%** Aggressive |

Hold band is ±3pp around the target (anti-flap). Outside the band the recommendation translates the gap into a concrete `amount_bps` using actual balances + price + TVL. Every step is reproducible off-chain by anyone with the same inputs.

Default state remains 100% base stable asset. Each vault's on-chain `policy` independently caps post-trade risk exposure (15% / 30% / 50% depending on preset) — the matrix never exceeds the cap.

---

## Defensive verifier contract

The LLM is a **defensive verifier**, not a free trader. After `parseAgentDecision()`, the agent runs `validateAgainstRecommendation()` (defined in `agent.ts`) which enforces:

- In `crash` or `drawdown_breach` regimes, **no Rebalance buy is permitted** — `amount_bps` must be 0 if the action is `Rebalance`.
- For a `Rebalance` recommendation of *N* bps, the LLM may return a buy in `[0, N]` or fall back to hold; never `> N`.
- For an `EmergencyDeleverage` recommendation of *N* bps, the LLM must return at least *N* — under-trimming a defensive recommendation is forbidden.
- Hold (`amount_bps = 0`) is universally permitted.

Any contract violation is rejected at the agent layer with a logged reason; the cycle is skipped without an on-chain swap. This makes the "AI as defensive verifier" claim machine-checked in the call path, not only stated in the prompt doctrine.

---

## Trust boundary

Sentri does not oversell what's verified on-chain.

### What the chain verifies (on every `executeStrategy`)

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

### What the chain does NOT verify (and why this is honest)

- **The full TEE attestation report is NOT cryptographically verified on-chain.** The agent verifies the 0G response off-chain with `broker.inference.processResponse(provider, chatID, content)` and the vault verifies the TEE signer signature over the provider signed chat payload on-chain. The on-chain check proves the payload came from the INFT-bound TEE signer; the broader provider attestation and service verification remain off-chain and auditable.
- **The contract does not parse the model JSON response.** The vault verifies the TEE signer, deadline, and single-use hashes on-chain, then stores the intent/response hashes for audit. The dashboard's audit page binds the verified model response, signed chat payload, reconstructed execution intent, transaction hash, and 0G Storage proof for human verification.
- **The off-chain decision is taken by the agent**, not by the contract. The contract enforces bounds; it does not compute the strategy. A malicious agent inside the bounded envelope can still pick the worst-of-allowed-actions, but it cannot exceed risk exposure, drawdown, slippage, or cooldown.
- **The market price uses a two-source minimum, network-appropriate per asset.** On 0G mainnet (W0G), the agent fetches the price from **Jaine V3 `slot0()` on-chain** and from **Pyth Network** (Hermes endpoint). Both must succeed for trading to be enabled, the spread between them is bounded (≤5% by default), and CoinGecko is queried opportunistically for 24h change only — its failure does not block trading. On Galileo (ETH), the agent uses a 4-CEX median (Binance, CoinGecko, Coinbase, Kraken) with a 2-of-4 quorum since these endpoints don't rate-limit ETH. A coordinated manipulation across the on-chain Jaine pool **and** the Pyth publisher set would be required to push a bad mainnet price.
- **The Galileo swap routes through `SentriPair`**, an in-protocol AMM seeded with `MockUSDC`/`MockWETH` for testnet reproducibility. The 0G mainnet route uses `USDC.E` / bridged USDC and `W0G` on Jaine.

### What this means for the user

A vault owner can reason about Sentri's safety along **two independent dimensions**:

1. **Bound** — what's the worst the agent can do within policy? This is fully on-chain and tight: bounded post-trade risk exposure, bounded drawdown from peak, bounded slippage per swap, bounded cadence (cooldown). The owner sets the bounds at vault creation and can update them; the agent cannot.
2. **Recourse** — what happens if something goes wrong? `pause()` blocks all activity reversibly; `emergencyWithdraw()` returns 100% of base + risk assets to the owner irreversibly; `emergencyDeleverageAndWithdraw(minBaseOut)` attempts to swap all risk exposure to the base stable asset first and reverts if the slippage guard cannot be met. All are owner-only and not gated by the agent or the price feed.

The TEE story is split honestly: 0G response verification and provider attestation happen off-chain in the agent, while the vault checks the recovered TEE signer signature on-chain, rejects expired/replayed intents, and commits the intent hash for audit replay.

---

## 0G asset model

- **Galileo rehearsal:** `MockUSDC` / `MockWETH` through `SentriPair`, so judges and contributors can reproduce the full loop without depending on third-party liquidity.
- **0G mainnet target:** `USDC.E` / bridged USDC as the base stable asset, with `W0G` as the primary risk asset and Jaine as the real-market venue.
- **No native-USDC claim:** Sentri does not claim that Circle-issued native USDC is available on 0G mainnet. `USDC.E` is a bridged stablecoin and carries bridge/liquidity risk; Sentri treats that as an explicit asset risk parameter.

The core vault logic is venue-agnostic: it enforces ownership, TEE signer checks, replay/deadline checks, exposure caps, drawdown, cooldown, oracle freshness, and slippage independently from whether the route is the deterministic Galileo AMM or a real 0G mainnet venue. The mainnet path uses `JaineV3PoolAdapter`, which adapts the public Jaine `USDC.E/W0G` V3 pool to the same `swapExactTokensForTokens(...)` surface the vault already uses on Galileo.

---

## Test coverage

Notable coverage:

- **Init pattern guard** (impl disabled, double-init revert, zero-address)
- **Per-vault policy enforcement** (cooldown, post-trade risk exposure, drawdown, slippage, stale price)
- **Cross-vault isolation** (one vault's pause doesn't affect others; one owner can't touch another's vault; shared INFT revocation freezes all vaults at once)
- **HWM proportional scaling on withdraw** (a withdrawal shrinks the vault but does not register as strategy drawdown)
- **AMM K-invariant on swaps** both directions
- **Custom policy bound enforcement** (out-of-range reverts)
- **Jaine adapter callback validation** (only the immutable pool can call back, path is checked, `amountToPay <= amountInMax`)

Run `cd contracts && forge test` — full output in ~1 second.

---

## Out of scope (intentional)

- **Active trading / perp strategies.** Sentri rebalances and risk-manages — it does not chase short-term alpha.
- **Multiple risk assets per vault.** One base stable + one risk asset per vault by design.
- **Multi-chain.** v1 targets 0G mainnet for review and Galileo for rehearsal. Cross-chain coordination is in the v3 roadmap.
- **Agent marketplace / operator competition.** Single shared verified agent, custom vault policies. The differentiation is one verified operator, your vault, your policy — not a market of unverified operators. Operator INFTs are in the v2 roadmap.
- **Persistent memory across iterations.** Stateless by design — auditability first.
- **Formal audit.** Contracts are covered by focused Foundry tests and static review, but have not undergone a third-party audit. Scheduled in the v1.1 roadmap.

---

## 0G SDK note

The agent uses `@0glabs/0g-serving-broker` 0.7.4 because it exposes the Direct Compute broker methods used by the TeeML flow, including `processResponse()` and chat signature retrieval. The package's ESM entry is loaded through its CJS path in the agent because the published ESM export is currently unreliable in this environment.

---

## Re-deploy

### Galileo

```bash
cd contracts
cp .env.example .env                             # fill PRIVATE_KEY + AGENT_ADDRESS + TEE_SIGNER_ADDRESS
forge build
forge test
forge script script/Deploy.s.sol --rpc-url galileo --broadcast --priority-gas-price 2000000000
```

The deploy script outputs every address. Update `packages/sdk/src/constants.ts` and `apps/web/src/config/contracts.ts` with the new factory address.

### 0G Mainnet (use a fresh mainnet key)

```bash
cd contracts
cp .env.example .env                             # fill PRIVATE_KEY_MAINNET + AGENT_ADDRESS_MAINNET + TEE_SIGNER_ADDRESS
forge build
forge script script/DeployMainnetReal.s.sol --rpc-url https://evmrpc.0g.ai --broadcast
```

Run the agent and the dashboard in mainnet mode by setting:

```
SENTRI_NETWORK=mainnet
MARKET_ASSET=W0G
SENTRI_BASE_SYMBOL=USDC.E
SENTRI_RISK_SYMBOL=W0G
NEXT_PUBLIC_SENTRI_NETWORK=mainnet
NEXT_PUBLIC_BASE_SYMBOL=USDC.E
NEXT_PUBLIC_RISK_SYMBOL=W0G
```

The mainnet script creates an empty demo vault; any `USDC.E` deposit is an explicit owner action.
