# Sentri Contracts

Solidity 0.8.24 · Foundry · OpenZeppelin v5 · 0G Mainnet (chainId 16661) + Galileo testnet (chainId 16602)

## Contract overview

| Contract | Purpose |
|---|---|
| `TreasuryVault` | Per-user vault clone (EIP-1167). Holds base + risk assets. Enforces all policy checks before any swap. On-chain execution log. |
| `TreasuryVaultTrustlessOracle` | V2 variant: replaces keeper-pushed price with a Pyth pull oracle verified on-chain in the same tx as the swap (`executeStrategyWithPyth`). |
| `VaultFactory` | V1 factory. Deploys `TreasuryVault` clones with preset or custom policies. |
| `VaultFactoryV2` | V2 factory. Deploys `TreasuryVaultTrustlessOracle` clones. Opt-in per vault. |
| `AgentINFT` | ERC-7857-aligned agent identity. Gates `executeStrategy` — agent must hold an active INFT whose registered TEE signer matches the recovered ECDSA signer in every execution call. |
| `JaineV3PoolAdapter` | Hardened single-pool adapter for the Jaine `USDC.E/W0G` 0.3% pool on 0G mainnet. Slippage-protected. |
| `SentriPriceFeed` | Keeper-pushed oracle. Mainnet keeper fetches Jaine `slot0()` + Pyth Hermes `0G/USD`, requires both to succeed and agree within spread bound. |
| `SentriSwapRouter` | Testnet-only swap router (Galileo). Replaced by `JaineV3PoolAdapter` on mainnet. |
| `SentriPair` | Testnet-only AMM pair (Galileo). |
| `MockUSDC` / `MockWETH` | Testnet ERC-20 mocks with public mint. |
| `oracle/PythPriceAdapter` | Thin adapter normalising Pyth `getPriceNoOlderThan()` to the `SentriPriceFeed` interface used by `TreasuryVaultTrustlessOracle`. |

## Deployed addresses

### 0G Mainnet (chainId 16661)

| Contract | Address |
|---|---|
| `VaultFactory` | [`0x9EE0c94c87FaDeB6dFb619B2C429eC05bc623cc7`](https://chainscan.0g.ai/address/0x9EE0c94c87FaDeB6dFb619B2C429eC05bc623cc7) |
| `TreasuryVault` impl | [`0xf86013C68811047F6dEc98c4ED6601C80B720668`](https://chainscan.0g.ai/address/0xf86013C68811047F6dEc98c4ED6601C80B720668) |
| `AgentINFT` | [`0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951`](https://chainscan.0g.ai/address/0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951) |
| `JaineV3PoolAdapter` | [`0xAdf55d5380f216F53f109B6B8341C9169BaeEBa4`](https://chainscan.0g.ai/address/0xAdf55d5380f216F53f109B6B8341C9169BaeEBa4) |
| `SentriPriceFeed` | [`0x1289638A90da7F24DB069168648819607A7377e6`](https://chainscan.0g.ai/address/0x1289638A90da7F24DB069168648819607A7377e6) |
| `VaultFactoryV2` | [`0xA3588d1964F7CeCDcFac15e38D286554955CF58C`](https://chainscan.0g.ai/address/0xA3588d1964F7CeCDcFac15e38D286554955CF58C) |
| `TreasuryVaultTrustlessOracle` impl | [`0x0F8b9A0c064306F938912658c96c681D8655140B`](https://chainscan.0g.ai/address/0x0F8b9A0c064306F938912658c96c681D8655140B) |
| `USDC.E` (bridged) | [`0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E`](https://chainscan.0g.ai/address/0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E) |
| `W0G` | [`0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c`](https://chainscan.0g.ai/address/0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c) |
| Demo vault (Aggressive) | [`0x20e8B2De8Ac2c8c5EE662Ea9986EC280FaebcA8E`](https://chainscan.0g.ai/address/0x20e8B2De8Ac2c8c5EE662Ea9986EC280FaebcA8E) |

Canonical V2 execution tx (`executeStrategyWithPyth`): [`0x45ab1a82…7317fa`](https://chainscan.0g.ai/tx/0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa)

### 0G Galileo testnet (chainId 16602)

| Contract | Address |
|---|---|
| `VaultFactory` | [`0x8a94F377De5450269e2035C8fAE31dE1E181F10e`](https://chainscan-galileo.0g.ai/address/0x8a94F377De5450269e2035C8fAE31dE1E181F10e) |
| `TreasuryVault` impl | [`0x2A33268CbB4a5639063331Db94FD94a8426765C0`](https://chainscan-galileo.0g.ai/address/0x2A33268CbB4a5639063331Db94FD94a8426765C0) |
| `AgentINFT` | [`0x1181A8670d5CA9597D60fEf2A571a14C58F33020`](https://chainscan-galileo.0g.ai/address/0x1181A8670d5CA9597D60fEf2A571a14C58F33020) |
| `SentriSwapRouter` | [`0xD58b37C4d838aad5E0734ba3F0d34DFA34186d7C`](https://chainscan-galileo.0g.ai/address/0xD58b37C4d838aad5E0734ba3F0d34DFA34186d7C) |
| `SentriPair` | [`0x0BeC7F13a4E9DAc95954EcdF3FF2DABd8279700f`](https://chainscan-galileo.0g.ai/address/0x0BeC7F13a4E9DAc95954EcdF3FF2DABd8279700f) |
| `SentriPriceFeed` | [`0x0e75243d34E904Ab925064c8297b36484Ce2aB5E`](https://chainscan-galileo.0g.ai/address/0x0e75243d34E904Ab925064c8297b36484Ce2aB5E) |
| `MockUSDC` | [`0xAcd0cc301eB160aA8C19B02a9Fac9a1967A69bE3`](https://chainscan-galileo.0g.ai/address/0xAcd0cc301eB160aA8C19B02a9Fac9a1967A69bE3) |
| `MockWETH` | [`0x246e6080D736A217C151C3b88890C08e2C249d5E`](https://chainscan-galileo.0g.ai/address/0x246e6080D736A217C151C3b88890C08e2C249d5E) |
| Demo vault (Aggressive) | [`0x5Aa3a7083915F6213238fc8c7461be969d5504e2`](https://chainscan-galileo.0g.ai/address/0x5Aa3a7083915F6213238fc8c7461be969d5504e2) |

## Security model

**On-chain enforcement in `executeStrategy` / `executeStrategyWithPyth`:**

1. `onlyAgent` — caller must be the registered agent address
2. `agentNFT.isActiveAgent(msg.sender)` — INFT must be active (not revoked)
3. `agentNFT.isAuthorizedForVault(msg.sender, address(this))` — INFT must be authorised for this specific vault
4. `_verifyTEE()` — ECDSA recovery from the TEE-signed response; recovered signer must match `agentNFT.isActiveAgentWithSigner(msg.sender, teeSigner)`
5. `usedIntentHashes` + `usedResponseHashes` — replay protection; each intent and response hash may only be used once
6. `block.timestamp > deadline` — intent expiry
7. `_enforceCooldown()` — minimum time between executions
8. Post-swap: `_enforceRiskExposure()` (maxAllocationBps cap) and `_enforceDrawdown()` (maxDrawdownBps from high-water mark)
9. Oracle freshness: `maxPriceStaleness` checked before every price read
10. Slippage: `minOut` derived from oracle price × `(10000 - maxSlippageBps)`

**Kill controls** (owner-only, bypass policy):
- `pause()` / `unpause()` — freeze/resume all agent activity reversibly
- `emergencyWithdraw()` — sets `killed = true`, returns all base + risk to owner immediately
- `emergencyDeleverageAndWithdraw(minBaseOut)` — attempts base-asset exit before withdrawing; reverts if slippage guard not met

## Build and test

```bash
# From repo root
cd contracts
forge build
forge test
```

7 test suites: `TreasuryVault`, `TrustlessOracle`, `AgentINFT`, `VaultFactory`, `MultiVault`, `SentriPair`, `JaineV3PoolAdapter`. Run `forge test` for live count.

```bash
# Verify a specific execution independently (read-only, no key required)
cd ..
pnpm install
pnpm --filter @steward/sdk verify:summary -- --tx 0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa
```
