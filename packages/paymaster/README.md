# @steward/paymaster

ERC-7677 paymaster signer service. Sponsors gas for Sentri's Safe-based smart
wallets on 0G so email/social users (Privy embedded wallets) can transact
without holding OG.

It pairs with the on-chain **VerifyingPaymaster** (audited eth-infinitism
contract, deployed via `contracts/script/DeployPaymaster.s.sol`). The contract
trusts this service's `verifyingSigner` key to decide which UserOps to sponsor.

## How it works

1. Privy's smart wallet calls this service over ERC-7677
   (`pm_getPaymasterStubData` for estimation, then `pm_getPaymasterData`).
2. The service applies the sponsorship **policy** (`src/policy.ts`): it decodes
   the Safe `executeUserOp` target and only sponsors calls into allowlisted
   Sentri contracts.
3. For an approved op it signs `VerifyingPaymaster.getHash(...)` with the
   `verifyingSigner` key and returns the signed `paymasterData`.
4. The on-chain paymaster recovers the signature in `validatePaymasterUserOp`
   and pays the gas from its EntryPoint deposit.

The off-chain/on-chain hash agreement is the critical property — covered by
`src/sign.test.ts` (TS side) and `contracts/test/Paymaster.t.sol` (Solidity).

## Env

| Var | Required | Purpose |
|-----|----------|---------|
| `PAYMASTER_SIGNER_PRIVATE_KEY` | yes | Off-chain signer key. **Server-only** — never `NEXT_PUBLIC_`, never the frontend. |
| `PAYMASTER_ADDRESS` | yes | Deployed VerifyingPaymaster contract address. |
| `PAYMASTER_TARGET_ALLOWLIST` | yes (prod) | Comma-separated Sentri contracts allowed to be sponsored (vault factory, base token, vaults). |
| `PAYMASTER_CHAIN_ID` | no | Default `16661` (0G mainnet). |
| `ENTRYPOINT` | no | Default canonical EntryPoint v0.7. |
| `PAYMASTER_VALIDITY_SECONDS` | no | Sponsorship validity window. Default `3600`. |
| `PAYMASTER_VERIFICATION_GAS_LIMIT` | no | Default `75000`. |
| `PAYMASTER_POSTOP_GAS_LIMIT` | no | Default `0`. |
| `PAYMASTER_ALLOW_ALL` | no | `true` sponsors every op — **local testing only**. |
| `PORT` | no | Default `8787`. |

## Setup order

```bash
# 1. Generate a fresh signer key (store it ONLY in the server env).
#    Then derive the address the paymaster must trust:
PAYMASTER_SIGNER_PRIVATE_KEY=0x... pnpm --filter @steward/paymaster signer-address

# 2. Deploy the paymaster with that address as verifyingSigner, and fund it:
cd contracts
PAYMASTER_VERIFYING_SIGNER=0x<from step 1> \
PAYMASTER_DEPOSIT_WEI=5000000000000000000 \
PAYMASTER_STAKE_WEI=1000000000000000000 \
forge script script/DeployPaymaster.s.sol --rpc-url og_mainnet --broadcast

# 3. Run the service (Render), set PAYMASTER_ADDRESS to the deployed address
#    and PAYMASTER_TARGET_ALLOWLIST to the Sentri contracts.
pnpm --filter @steward/paymaster build && pnpm --filter @steward/paymaster start
```

Then in the Privy dashboard, configure 0G as a custom chain with this service's
URL as the **paymaster URL** (and the self-hosted bundler URL), smart-wallet
type `safe`.

## Test

```bash
pnpm --filter @steward/paymaster test
```
