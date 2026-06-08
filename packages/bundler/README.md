# sentri-bundler

Self-hosted ERC-4337 bundler for 0G, using [Etherspot Skandha](https://github.com/etherspot/skandha).

0G isn't supported by any hosted bundler (Pimlico, Alchemy), so we run our own,
pointed at the 0G RPC and the canonical **EntryPoint v0.7** already deployed on
0G (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`). The bundler is the service
Privy's smart wallet submits sponsored UserOps to.

## Pieces of the gasless chain

```
Privy smart wallet ──(UserOp)──> this bundler ──> EntryPoint v0.7 (0G)
                          │
                          └──(sponsorship)──> @steward/paymaster signer service
                                                   └──> VerifyingPaymaster (0G)
```

## Deploy on Render (Docker)

1. New **Web Service** → build from this repo, Docker, `packages/bundler/Dockerfile`.
2. Env vars:
   | Var | Value | Notes |
   |-----|-------|-------|
   | `SKANDHA_RELAYERS` | `0x<relayer private key>` | **Secret, server-only.** The EOA that submits bundles. Never the frontend. |
   | `SKANDHA_RPC` | `https://evmrpc.0g.ai` | 0G mainnet RPC. |
   | `SKANDHA_ENTRYPOINTS` | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | EntryPoint v0.7. |
3. Port: Skandha listens on **14337** — set the Render service port to 14337 if
   it isn't auto-detected from the Dockerfile `EXPOSE`.

### Fund the relayer

The relayer EOA (`SKANDHA_RELAYERS`) **fronts the gas** for each bundle on-chain
and is reimbursed by the EntryPoint out of the paymaster's deposit. It needs a
small working balance of **OG (~1–2)** to operate. This is separate from the
5–10 OG that funds the paymaster deposit.

> The committed `config.json` carries only non-secret network params with a
> placeholder relayer (the public test mnemonic). `SKANDHA_RELAYERS` overrides
> it at runtime — never commit a real key.

## Bundler URL for Privy

Once live, the bundler RPC URL is your Render service URL. Skandha serves the
bundler JSON-RPC per chain, so the URL is typically:

```
https://<your-render-service>.onrender.com/16661
```

Confirm the exact path from the Skandha startup logs, then set it as the
**bundler URL** for the 0G custom chain in the Privy dashboard (alongside the
`@steward/paymaster` URL as the paymaster URL, smart-wallet type `safe`).
