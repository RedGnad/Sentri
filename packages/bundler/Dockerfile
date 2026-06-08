# Self-hosted ERC-4337 bundler for 0G (Etherspot Skandha).
# 0G is not covered by any hosted bundler, so we run our own pointed at the 0G
# RPC + the canonical EntryPoint v0.7 already deployed on 0G.
#
# Secrets (the relayer key) are NOT baked in — they come from SKANDHA_RELAYERS
# at runtime (set in the Render dashboard). The committed config.json holds only
# the non-secret network params; the relayer placeholder MUST be overridden.
FROM etherspot/skandha:latest

COPY config.json /usr/app/config.json

EXPOSE 14337

CMD ["standalone"]
