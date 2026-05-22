// Human-readable verdicts for agent cycle outcomes.
//
// The runner emits machine-ish outcomes (status + terse reason). A user looking
// at a dashboard must not see a bare "skipped" and conclude "it's broken" — a
// vault can be perfectly healthy and still skip a cycle (target reached,
// cooldown, defensive hold, …). `describeOutcome` maps an outcome to a clear
// sentence + a tone for styling. Pure function, no I/O.
//
// This module changes NO strategy logic — it only relabels existing outcomes.

export type VerdictTone = "ok" | "info" | "waiting" | "blocked" | "error";

export interface Verdict {
  /** One-sentence, user-facing explanation of the cycle outcome. */
  text: string;
  /** Coarse severity for UI styling. */
  tone: VerdictTone;
}

/** Structural shape of an IterationOutcome — kept local to avoid import cycles. */
interface OutcomeLike {
  status: string;
  reason?: string;
  action?: string;
}

const has = (reason: string, ...needles: string[]): boolean =>
  needles.some((n) => reason.includes(n));

/**
 * Map a cycle outcome to a user-facing verdict. Skip reasons are matched on the
 * stable strings the runner produces in agent.ts; unknown reasons fall back to
 * the raw text so nothing is ever hidden.
 */
export function describeOutcome(outcome: OutcomeLike): Verdict {
  const reason = outcome.reason ?? "";

  if (outcome.status === "executed") {
    return {
      tone: "ok",
      text: `Executed — ${outcome.action ?? "strategy action"} completed on-chain.`,
    };
  }

  if (outcome.status === "killed") {
    return {
      tone: "blocked",
      text: "Kill-switch engaged — autonomous execution is stopped for this vault. Funds are safe and withdrawable.",
    };
  }

  if (outcome.status === "error") {
    if (has(reason, "InsufficientAvailableBalance", "insufficient balance", "add more funds", "transfer-fund")) {
      return {
        tone: "waiting",
        text: "Paused — the 0G inference account needs topping up. The agent retries automatically after a backoff.",
      };
    }
    return { tone: "error", text: `Cycle error — ${reason || "unexpected runner error"}.` };
  }

  if (outcome.status !== "skipped") {
    return { tone: "info", text: reason || outcome.status };
  }

  // ── skipped ──────────────────────────────────────────────────────────────
  if (has(reason, "SKIPPED_TEE_SIGNER_MISMATCH", "TEE signer not bound")) {
    return {
      tone: "blocked",
      text: "Auto-execution blocked — the TEE signer is not bound to the active AgentINFT. Operator action required; funds are safe.",
    };
  }
  if (has(reason, "vault is paused")) {
    return { tone: "waiting", text: "Paused — execution is suspended by the vault owner." };
  }
  if (has(reason, "vault is empty")) {
    return { tone: "info", text: "Idle — the vault is empty. Deposit funds for the agent to manage." };
  }
  if (has(reason, "inference funding backoff")) {
    return {
      tone: "waiting",
      text: "Paused — 0G inference credits need topping up. The agent retries automatically after a backoff.",
    };
  }
  if (
    has(
      reason,
      "market health",
      "market data unavailable",
      "Insufficient market quorum",
      "trading requires",
      "Jaine on-chain price",
    )
  ) {
    return {
      tone: "waiting",
      text: "Holding — risk-asset price failed the multi-source sanity check. The agent waits for reliable market data.",
    };
  }
  if (has(reason, "oracle price stale", "price stale", "PriceStale")) {
    return {
      tone: "waiting",
      text: "Blocked safely — the oracle price was stale, so execution stopped before funds moved. The agent waits for a fresh price.",
    };
  }
  if (has(reason, "audit persistence unavailable", "SKIPPED_AUDIT_STORAGE")) {
    return {
      tone: "waiting",
      text: "Blocked safely — the TEE reasoning could not be durably indexed, so execution stopped before funds moved.",
    };
  }
  if (has(reason, "below dust threshold")) {
    return {
      tone: "ok",
      text: "Defensive hold — the strategy would reduce risk further, but the risk position is negligible (the vault is effectively all stablecoin). Nothing left to sell; funds are safe.",
    };
  }
  if (has(reason, "exposure headroom")) {
    return {
      tone: "ok",
      text: "Target reached — the vault is at its policy maximum risk allocation. Rebalances resume once drift or headroom returns.",
    };
  }
  if (has(reason, "no action needed", "deterministic hold", "amount_bps=0")) {
    return {
      tone: "ok",
      text: "Holding — the current allocation is within the target band. No action needed this cycle.",
    };
  }
  if (has(reason, "anti-churn")) {
    return {
      tone: "ok",
      text: "Anti-churn hold — a small reversal of the recent trade was skipped while the regime settles. The position stays within policy; funds are safe.",
    };
  }
  if (has(reason, "minimum economic size")) {
    return {
      tone: "ok",
      text: "Holding — the rebalance is below the minimum economic trade size, so it was skipped to avoid gas and compute churn.",
    };
  }
  if (has(reason, "no base balance")) {
    return { tone: "info", text: "Holding — no stablecoin balance available to deploy." };
  }
  if (has(reason, "no risk balance")) {
    return { tone: "ok", text: "Holding — there is no risk position to reduce." };
  }
  if (has(reason, "cooldown")) {
    return {
      tone: "waiting",
      text: "Cooldown — waiting for the policy cooldown window before the next action.",
    };
  }
  if (has(reason, "allocation exceeded")) {
    return {
      tone: "ok",
      text: "Holding — the proposed trade would exceed the policy allocation cap; blocked by the on-chain guard.",
    };
  }
  if (has(reason, "drawdown breached")) {
    return {
      tone: "ok",
      text: "Defensive hold — the proposed trade would breach the policy drawdown limit; blocked by the on-chain guard.",
    };
  }
  if (has(reason, "slippage")) {
    return {
      tone: "waiting",
      text: "Skipped — the swap exceeded the slippage guard. The agent retries next cycle.",
    };
  }
  if (has(reason, "defensive override", "model disagreement")) {
    return {
      tone: "info",
      text: "Verifier hold — the model disagreed with the deterministic policy, so the agent skipped the trade. No funds moved.",
    };
  }
  if (has(reason, "invalid JSON", "invalid amount_bps", "invalid action", "invalid confidence")) {
    return {
      tone: "info",
      text: "Skipped — the model returned an unusable response. The agent retries next cycle.",
    };
  }
  if (has(reason, "on-chain revert")) {
    return { tone: "info", text: `Skipped — an on-chain guard rejected the trade (${reason}).` };
  }

  return { tone: "info", text: reason || "Skipped this cycle." };
}
