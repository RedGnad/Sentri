import express from "express";
import { toHex, type Address } from "viem";
import { config, assertServerConfig } from "./config.js";
import { isSponsorable } from "./policy.js";
import {
  buildPaymasterData,
  signPaymasterData,
  DUMMY_SIGNATURE,
  type UnpackedUserOp,
} from "./sign.js";

assertServerConfig();

const app = express();
app.use(express.json({ limit: "1mb" }));

type RpcReq = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown[] };

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Health check (Render pings this).
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
  const body = req.body as RpcReq;
  const id = body?.id ?? null;
  const method = body?.method;
  const params = (body?.params ?? []) as unknown[];

  try {
    if (method === "pm_supportedEntryPoints") {
      return res.json(rpcResult(id, [config.entryPoint]));
    }

    if (method === "pm_getPaymasterStubData" || method === "pm_getPaymasterData") {
      const op = params[0] as UnpackedUserOp;
      const entryPoint = (params[1] as Address) ?? config.entryPoint;
      const chainId = params[2] != null ? Number(params[2]) : config.chainId;

      if (!op || !op.callData) {
        return res.json(rpcError(id, -32602, "missing userOp"));
      }
      if (entryPoint && entryPoint.toLowerCase() !== config.entryPoint.toLowerCase()) {
        return res.json(rpcError(id, -32602, `unsupported entryPoint ${entryPoint}`));
      }

      const policy = isSponsorable(op.callData);
      if (!policy.ok) {
        return res.json(rpcError(id, -32001, `not sponsorable: ${policy.reason}`));
      }

      const now = Math.floor(Date.now() / 1000);
      const validAfter = 0;
      const validUntil = now + config.validitySeconds;

      const base = {
        paymaster: config.paymasterAddress,
        paymasterVerificationGasLimit: toHex(config.pmVerificationGasLimit),
        paymasterPostOpGasLimit: toHex(config.pmPostOpGasLimit),
      };

      // Stub: dummy signature so the bundler's gas estimation sees a realistic
      // payload size. The real signature is issued in pm_getPaymasterData once
      // the gas fields are final (VerifyingPaymaster signs over them).
      if (method === "pm_getPaymasterStubData") {
        const paymasterData = buildPaymasterData(validUntil, validAfter, DUMMY_SIGNATURE);
        return res.json(rpcResult(id, { ...base, paymasterData, isFinal: false }));
      }

      const paymasterData = await signPaymasterData({
        signerPrivateKey: config.signerPrivateKey,
        op,
        paymaster: config.paymasterAddress,
        chainId,
        pmVerificationGasLimit: config.pmVerificationGasLimit,
        pmPostOpGasLimit: config.pmPostOpGasLimit,
        validUntil,
        validAfter,
      });
      return res.json(rpcResult(id, { ...base, paymasterData }));
    }

    return res.json(rpcError(id, -32601, `method not found: ${method}`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.json(rpcError(id, -32603, `internal error: ${msg}`));
  }
});

app.listen(config.port, () => {
  console.log(
    `[paymaster] listening on :${config.port} chainId=${config.chainId} ` +
      `paymaster=${config.paymasterAddress} allowAll=${config.allowAll}`,
  );
});
