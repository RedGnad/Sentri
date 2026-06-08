# Self-hosted ERC-4337 bundler for 0G — alto (Pimlico).
#
# We switched from Skandha to alto: Skandha's public image validates the v0.6
# packed userOp schema and rejects the v0.7 UNPACKED format that viem / Privy
# smart wallets send (factory/paymaster split fields), failing with -32600.
# alto is the viem-native reference bundler and speaks v0.7 unpacked correctly,
# and is permissive about custom chains like 0G.
#
# Config is passed as CLI flags sourced from env so secrets (the executor key)
# stay in the Render dashboard, never in git. Required env on the service:
#   ENTRYPOINTS            0x0000000071727De22E5E9d8BAf0edAc6f37da032  (EP v0.7)
#   RPC_URL               https://evmrpc.0g.ai
#   EXECUTOR_PRIVATE_KEYS 0x<funded relayer key> (submits bundles, pays gas, reimbursed)
#   UTILITY_PRIVATE_KEY   0x<key> (refills executors; can be the same for testing)
#
# safe-mode is off because 0G's public RPC may not expose debug_traceCall, which
# safe-mode validation relies on.
FROM ghcr.io/pimlicolabs/alto:latest

EXPOSE 4337

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["node src/lib/cli/alto.js run \
  --entrypoints \"$ENTRYPOINTS\" \
  --rpc-url \"$RPC_URL\" \
  --executor-private-keys \"$EXECUTOR_PRIVATE_KEYS\" \
  --utility-private-key \"$UTILITY_PRIVATE_KEY\" \
  --safe-mode false \
  --port 4337"]
