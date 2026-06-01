import { toast } from "sonner";
import { BASE_SYMBOL } from "@/config/contracts";

/**
 * Maps a wagmi/viem transaction error to a short, human label plus the raw
 * message kept as `description` for the user who actually wants the hex.
 *
 * Goals:
 *  - A crypto user mid-level should know what to do from the title alone.
 *  - The raw revert / RPC payload stays one level down (toast description)
 *    so power users and bug reports still have the original string.
 *  - The set is intentionally short. Anything we have not specifically
 *    matched falls back to the original `error.message` — no fake
 *    confidence on edge cases.
 */
export interface TxErrorView {
  title: string;
  description?: string;
  // "cancelled" reverts are not real failures — the wallet UI just closed
  // without signing. Callers can choose to swallow this entirely or
  // downgrade the tone.
  cancelled?: boolean;
}

export function humanizeTxError(err: unknown): TxErrorView {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err ?? "");
  const lower = raw.toLowerCase();

  // 1. User rejected — most common "failure", not actually a failure.
  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request") ||
    lower.includes("rejected by user")
  ) {
    return { title: "Cancelled in wallet", cancelled: true };
  }

  // 2. Native funds for gas missing.
  if (
    lower.includes("insufficient funds for gas") ||
    lower.includes("insufficient funds for intrinsic transaction cost") ||
    lower.includes("sender doesn't have enough funds")
  ) {
    return {
      title: "Not enough OG for gas",
      description: "Top up the connected wallet with 0G before retrying.",
    };
  }

  // 3. ERC20 allowance — user tried to deposit without approving first
  // (or approved a smaller amount than they're now sending).
  if (
    lower.includes("erc20insufficientallowance") ||
    lower.includes("transfer amount exceeds allowance") ||
    lower.includes("insufficient allowance")
  ) {
    return {
      title: `Approve ${BASE_SYMBOL} first`,
      description: raw,
    };
  }

  // 4. ERC20 balance.
  if (
    lower.includes("erc20insufficientbalance") ||
    lower.includes("transfer amount exceeds balance")
  ) {
    return {
      title: `Insufficient ${BASE_SYMBOL} balance`,
      description: raw,
    };
  }

  // 5. Vault state guards.
  if (
    lower.includes("enforcedpause") ||
    lower.includes("pausable: paused") ||
    lower.includes("expectedpause")
  ) {
    return {
      title: "Vault is paused",
      description:
        "Unpause from the Emergency tab to resume deposits, withdrawals, and the agent cycle.",
    };
  }
  if (lower.includes("vaultkilled") || lower.includes("killed")) {
    return {
      title: "Vault has been killed",
      description: "This vault was permanently disabled via the kill-switch.",
    };
  }
  if (
    lower.includes("ownableunauthorizedaccount") ||
    lower.includes("ownable: caller is not the owner") ||
    lower.includes("notowner")
  ) {
    return {
      title: "Owner-only action",
      description: "Connect the wallet that owns this vault.",
    };
  }

  // 6. Generic Solidity panic codes (e.g. 0x4e487b71 + 0x11 overflow).
  if (lower.includes("0x4e487b71")) {
    return {
      title: "Contract panic — retry",
      description: raw,
    };
  }

  // 7. Fallback — keep the raw revert as the title, no invented context.
  //    Trim very long messages so the toast doesn't blow up vertically.
  const trimmed = raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
  return { title: trimmed || "Transaction failed" };
}

/**
 * Toast helper that prefixes the action verb and surfaces a humanised reason.
 * `action` is the present-tense label of the thing that failed
 * (e.g. "Deposit", "Approve", "Pause").
 *
 * User-cancelled transactions are downgraded to a sonner info call so the
 * UI does not scream "FAILED" at the user every time they close the wallet.
 */
export function toastTxError(action: string, err: unknown): void {
  if (!err) return;
  const { title, description, cancelled } = humanizeTxError(err);
  if (cancelled) {
    toast.message(`${action} cancelled`);
    return;
  }
  toast.error(`${action} failed: ${title}`, description ? { description } : undefined);
}
