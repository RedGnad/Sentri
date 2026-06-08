import express from "express";
import { config, assertServerConfig } from "./config.js";
import { handlePaymasterRpc } from "./handler.js";

// Standalone ERC-7677 paymaster service. The same handler is also grafted onto
// the agent server (see @steward/sdk) to avoid a separate Render instance — this
// entrypoint exists for running the paymaster on its own (e.g. Railway).

assertServerConfig();

const app = express();
app.use(express.json({ limit: "1mb" }));

// Health check (Render/Railway pings this).
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "steward-paymaster",
    chainId: config.chainId,
    paymaster: config.paymasterAddress,
    entryPoint: config.entryPoint,
  });
});

// ERC-7677 paymaster JSON-RPC.
app.post("/", async (req, res) => {
  res.json(await handlePaymasterRpc(req.body));
});

app.listen(config.port, () => {
  console.log(
    `[paymaster] listening on :${config.port} chainId=${config.chainId} ` +
      `paymaster=${config.paymasterAddress} allowAll=${config.allowAll}`,
  );
});
