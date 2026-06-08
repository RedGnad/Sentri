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

// When the smart wallet batches several calls (e.g. approve + createVaultAndDeposit),
// the Safe delegatecalls into MultiSend/MultiSendCallOnly, so the executeUserOp
// `to` is the MultiSend contract and the real targets are packed inside `data`.
const MULTISEND_ABI = [
  {
    type: "function",
    name: "multiSend",
    stateMutability: "payable",
    inputs: [{ name: "transactions", type: "bytes" }],
    outputs: [],
  },
] as const;

// `multiSend(bytes)` selector — used to detect a batched delegatecall.
const MULTISEND_SELECTOR = "0x8d80ff0a";

/**
 * Parse MultiSend's tightly-packed `transactions` blob into the list of target
 * addresses. Each entry is: operation(1) ‖ to(20) ‖ value(32) ‖ dataLen(32) ‖ data(dataLen).
 */
function parseMultiSendTargets(transactions: Hex): Address[] {
  const targets: Address[] = [];
  const hex = transactions.slice(2); // strip 0x
  let i = 0;
  while (i + 2 + 40 + 64 + 64 <= hex.length) {
    i += 2; // operation (1 byte)
    const to = (`0x${hex.slice(i, i + 40)}`) as Address;
    i += 40; // to (20 bytes)
    targets.push(to);
    i += 64; // value (32 bytes)
    const dataLen = parseInt(hex.slice(i, i + 64), 16);
    i += 64; // dataLength (32 bytes)
    i += dataLen * 2; // data
  }
  return targets;
}

/**
 * Extract every call target a UserOp will reach: a single direct call, or all
 * inner calls when the Safe batches them through MultiSend. Returns null if the
 * callData can't be decoded as a Safe executeUserOp.
 */
export function extractTargets(callData: Hex): Address[] | null {
  try {
    const decoded = decodeFunctionData({ abi: SAFE_EXEC_ABI, data: callData });
    const to = decoded.args[0] as Address;
    const innerData = decoded.args[2] as Hex;
    const operation = Number(decoded.args[3]);

    // delegatecall into MultiSend → decode the batched inner targets.
    if (operation === 1 && innerData.slice(0, 10).toLowerCase() === MULTISEND_SELECTOR) {
      const ms = decodeFunctionData({ abi: MULTISEND_ABI, data: innerData });
      const targets = parseMultiSendTargets(ms.args[0] as Hex);
      return targets.length > 0 ? targets : [to];
    }

    return [to];
  } catch {
    return null;
  }
}

/** Back-compat single-target accessor (first reached target). */
export function extractTarget(callData: Hex): Address | null {
  const targets = extractTargets(callData);
  return targets && targets.length > 0 ? targets[0] : null;
}

export interface PolicyResult {
  ok: boolean;
  reason?: string;
  target?: Address;
}

/** Decide whether to sponsor this UserOp's gas. */
export function isSponsorable(callData: Hex): PolicyResult {
  if (config.allowAll) return { ok: true };

  const targets = extractTargets(callData);
  if (!targets || targets.length === 0) {
    return { ok: false, reason: "could not decode Safe executeUserOp target" };
  }
  // Every reached target (including each batched inner call) must be allowed.
  for (const target of targets) {
    if (!config.targetAllowlist.includes(target.toLowerCase())) {
      return { ok: false, reason: `target ${target} not in allowlist`, target };
    }
  }
  return { ok: true, target: targets[0] };
}
