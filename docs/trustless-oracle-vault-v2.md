# Trustless Oracle Vault (V2) — mainnet canary

**Status:** **live on 0G mainnet**, merged to `main`. The V2 tier runs alongside
the Standard tier; both are agent-operated. The stack below was later redeployed
to carry the emergency-deleverage drawdown fix — current live addresses:

| Contract | Address |
|---|---|
| TreasuryVaultTrustlessOracle (impl) | `0x07b2b6f4f8185fBBa075Bb07F43bE9Fc05787eA7` |
| VaultFactoryV2 | `0xd5660Ef30460baa74950774DA55b515bdce5259F` |
| Canary vault (Balanced) | `0x7B6ee7D1145A59D725De47c59c4576e99B2cF0FC` |

The original canary deployment (superseded, now legacy) is documented below for history.

## Product positioning (two tiers)

| | Standard Vault (live) | Trustless Oracle Vault (V2) |
|---|---|---|
| Oracle | keeper-pushed `SentriPriceFeed` | **Pyth pull**, verified on-chain in the same tx |
| Per-tx oracle fee | none | **~0.2 OG / execution** (Pyth update fee on 0G) |
| Fit | cheap · frequent · retail micro-treasuries | **premium · high-assurance · larger capital / DAO · lower-frequency / policy-heavy** |
| Trust model | keeper-attested price + sealed TEE reasoning + on-chain policy | price cryptographically verified at execution (confidence + staleness bounds enforced on-chain) + sealed TEE reasoning + policy |

Honest line: *Trustless oracle execution path validated on 0G mainnet; best suited
to larger vaults / lower-frequency execution given the pull-oracle fee.* It is
**not** a universal replacement for Standard — it is a premium tier.

## Pyth on 0G mainnet (verified 2026-05-28/29)

- Pyth contract: `0x2880aB155794e7179c9eE2e38200202908C17B43` (`getValidTimePeriod()=60`)
- Feed Crypto.0G/USD: `0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070`
- Smoke test (`scripts/pyth-smoke.ts`, mainnet): `updatePriceFeeds` + `getPriceNoOlderThan`
  succeed, no StalePrice / InsufficientFee. Update fee = **0.2 OG**.

## Canary deployment (0G mainnet, chain 16661)

| Contract | Address | Tx |
|---|---|---|
| TreasuryVaultTrustlessOracle (impl) | `0x0F8b9A0c064306F938912658c96c681D8655140B` | `0x895d484129cecb0cd4ada3892c1931395296f53db16dde0691d8fc65ca5206ec` |
| VaultFactoryV2 | `0xA3588d1964F7CeCDcFac15e38D286554955CF58C` | `0xbd3ede9666eb2ed20d41fd1b7fc3df36596905fa3ee6700ef192e04c96abc1b3` |
| Canary vault (Balanced) | `0x86cE22c597D0C4EC309ba166360686C39A3f40ed` | `0x81cff80ace50a2cfb8051c015505667c5df7812e754a0c4b56a6fdf410f4fcb8` |
| AgentINFT.setAuthorizedFactory (owner tx) | target `0x822Ea3…87951` | `0x7c018f9fbd7050a7369267be0272c7a31bf9a9bf7cb16eea5c224446887a3d55` |

Vault config (verified): owner `0x79C5…1e45` (canary), agent `0x981F…720e0`,
`isAuthorizedForVault(agent,vault)=true`, pyth `0x2880…`, feed 0G/USD, policy
Balanced (maxAllocation 30%, maxDrawdown 5%, **maxSlippage 100bps**, cooldown
30min, maxPriceStaleness 60s).

**Cost:** impl 0.01222 + factory 0.003899 + createVault 0.0020305 = **~0.01815 OG**
(canary wallet); owner authorization ~0.000192 OG (`0x981F…`).

## Deploy sequence — option (b), no live owner-key exposure

`VaultFactoryV2._deployVault` only calls `authorizeUsageFromFactory` when the
factory is already authorized, so order matters:

1. **[canary key]** `forge script script/DeployTrustlessOracleCanary.s.sol --rpc-url og_mainnet --broadcast --legacy`
   with `DEPLOY_CREATE_VAULT=false` → deploys impl + factory only (no owner call).
2. **[owner `0x981F…`, single tx]** `AgentINFT.setAuthorizedFactory(factory, true)`.
3. **[canary key]** `cast send <factory> "createVault(uint8)" 1 --legacy` (1 = Balanced)
   → `authorizeUsageFromFactory` fires, vault is agent-operable.

Env for the script: `PRIVATE_KEY` (0x-prefixed), `AGENT_ADDRESS`, `AGENT_NFT_ADDRESS`,
`ROUTER_ADDRESS`, `BASE_TOKEN_ADDRESS`, `RISK_TOKEN_ADDRESS`, `AGENT_TOKEN_ID=0`,
`PYTH_CONTRACT_ADDRESS`, `PYTH_PRICE_ID`.

## Executions

`executeStrategyWithPyth` is `onlyAgent` + `_verifyTEE`: the tx signer must HOLD the
active AgentINFT (token 0) bound to the TEE signer `0x0038F7…`. Only `0x981F…`
qualifies, and it needs the working 0G compute broker for sealed inference.

The full trustless path has executed on mainnet — execution tx
`0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa` — so the
Pyth pull, on-chain verification, TEE boundary, and swap are proven end-to-end,
not just in theory. The agent runs the V2 tier with ~0.2 OG fee + gas per execution.
