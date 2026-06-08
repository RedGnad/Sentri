import { toHex, type Address } from "viem";
import { config } from "./config.js";
import { isSponsorable } from "./policy.js";
import { signPaymasterData, type UnpackedUserOp } from "./sign.js";

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown[];
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** True when the paymaster env (address + signer key) is set on this process. */
export function paymasterConfigured(): boolean {
  return !!config.paymasterAddress && !!config.signerPrivateKey;
}

/**
 * Core ERC-7677 paymaster RPC handler. Used both by the standalone service and
 * when the route is grafted onto the agent server (so there's one source of
 * truth — no duplicated signing logic). Returns "not configured" rather than
 * throwing when the host process has no paymaster env, so grafting it onto a
 * server that hasn't set the paymaster env can never crash that server.
 */
export async function handlePaymasterRpc(body: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = body?.id ?? null;
  const method = body?.method;
  const params = (body?.params ?? []) as unknown[];
  const err = (code: number, message: string): JsonRpcResponse => ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });

  if (!paymasterConfigured()) {
    return err(-32000, "paymaster not configured on this server");
  }

  try {
    if (method === "pm_supportedEntryPoints") {
      return ok([config.entryPoint]);
    }

    if (method === "pm_getPaymasterStubData" || method === "pm_getPaymasterData") {
      const op = params[0] as UnpackedUserOp;
      const entryPoint = (params[1] as Address) ?? config.entryPoint;
      const chainId = params[2] != null ? Number(params[2]) : config.chainId;

      if (!op || !op.callData) return err(-32602, "missing userOp");
      if (entryPoint && entryPoint.toLowerCase() !== config.entryPoint.toLowerCase()) {
        return err(-32602, `unsupported entryPoint ${entryPoint}`);
      }

      const policy = isSponsorable(op.callData);
      if (!policy.ok) return err(-32001, `not sponsorable: ${policy.reason}`);

      const now = Math.floor(Date.now() / 1000);
      const validAfter = 0;
      const validUntil = now + config.validitySeconds;

      const base = {
        paymaster: config.paymasterAddress,
        paymasterVerificationGasLimit: toHex(config.pmVerificationGasLimit),
        paymasterPostOpGasLimit: toHex(config.pmPostOpGasLimit),
      };

      // Sign for both stub and final. A real (canonical low-s) signature is
      // required even for the estimation stub: VerifyingPaymaster runs
      // ECDSA.recover during validation, and a malformed/high-s dummy makes OZ's
      // ECDSA revert (ECDSAInvalidSignatureS) → AA33. A real signature recovers
      // to a valid address so validation returns cleanly during estimation.
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

      if (method === "pm_getPaymasterStubData") {
        return ok({ ...base, paymasterData, isFinal: false });
      }
      return ok({ ...base, paymasterData });
    }

    return err(-32601, `method not found: ${method}`);
  } catch (e) {
    return err(-32603, `internal error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
