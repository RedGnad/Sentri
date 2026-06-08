import { decodeFunctionData, type Address, type Hex } from "viem";
import { config } from "./config.js";

// Safe4337Module wraps the user's real action in executeUserOp(to,value,data,op).
// We decode it to learn the actual target the UserOp will call, then check it
// against the allowlist so the paymaster only sponsors Sentri actions.
const SAFE_EXEC_ABI = [
  {
    type: "function",
    name: "executeUserOp",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "executeUserOpWithErrorString",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
    ],
    outputs: [],
  },
] as const;

/** Extract the call target from a Safe4337Module-wrapped UserOp callData. */
export function extractTarget(callData: Hex): Address | null {
  try {
    const decoded = decodeFunctionData({ abi: SAFE_EXEC_ABI, data: callData });
    return decoded.args[0] as Address;
  } catch {
    return null;
  }
}

export interface PolicyResult {
  ok: boolean;
  reason?: string;
  target?: Address;
}

/** Decide whether to sponsor this UserOp's gas. */
export function isSponsorable(callData: Hex): PolicyResult {
  if (config.allowAll) return { ok: true };

  const target = extractTarget(callData);
  if (!target) {
    return { ok: false, reason: "could not decode Safe executeUserOp target" };
  }
  if (!config.targetAllowlist.includes(target.toLowerCase())) {
    return { ok: false, reason: `target ${target} not in allowlist`, target };
  }
  return { ok: true, target };
}
