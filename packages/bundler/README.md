# sentri-bundler

Self-hosted ERC-4337 bundler for 0G, using [alto](https://github.com/pimlicolabs/alto) (Pimlico).

0G isn't supported by any hosted bundler, so we run our own, pointed at the 0G
RPC and the canonical **EntryPoint v0.7** (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`).
It's the service Privy's smart wallets submit sponsored UserOps to.

## Why alto (not Skandha)

Skandha's public Docker image validates the **v0.6 packed** userOp schema and
rejects the **v0.7 unpacked** format that viem / Privy smart wallets send
(separate `factory` / `paymaster` fields), returning `-32600 Invalid Request`.
alto is the viem-native bundler and speaks v0.7 unpacked correctly.

## Deploy on Render (Docker)

1. New **Web Service** → this repo, **Docker**, Dockerfile `packages/bundler/Dockerfile`,
   Docker build context `packages/bundler`, branch `main`.
2. Instance type: **Starter** (Free spins down → bundler unreachable; if you must
   use Free, ping it every ~10 min on a 2xx path to keep it warm — cold starts
   will still cause occasional failures).
3. Env vars:
   | Var | Value |
   |-----|-------|
   | `ENTRYPOINTS` | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
   | `RPC_URL` | `https://evmrpc.0g.ai` |
   | `EXECUTOR_PRIVATE_KEYS` | `0x<funded relayer key>` (server-only secret) |
   | `UTILITY_PRIVATE_KEY` | `0x<key>` (can be the same key for testing) |
4. Port: **4337** (set it if Render doesn't auto-detect the `EXPOSE`).
5. Health Check Path: leave blank.

### Fund the executor

The executor key (`EXECUTOR_PRIVATE_KEYS`) **fronts the gas** for each bundle on
0G and is reimbursed by the EntryPoint out of the paymaster's deposit. It needs a
small working balance of **OG (~1–2)**.

## Bundler URL for Privy

alto serves the bundler JSON-RPC at the **root** of the service, so the URL is
simply your Render service URL (confirm from the startup logs):

```
https://<your-render-service>.onrender.com
```

Set that as the **bundler URL** for the 0G custom chain in the Privy dashboard
(paymaster URL = `https://sentri-agent.onrender.com/paymaster`, smart-wallet type `safe`).
