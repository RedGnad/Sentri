// Shared strategy constants — single source of truth for thresholds that the
// runner's strategy classifier and the read-only diagnostics (inspect-vault)
// must agree on. Extracted verbatim from agent.ts; values are unchanged.

/**
 * Drawdown (% below the high-water mark) at which the off-chain strategy
 * classifier switches to the `drawdown_breach` regime (target 0%, deleverage).
 *
 * This is a STRATEGY threshold, deliberately stricter than the on-chain
 * `policy.maxDrawdownBps` hard guard: the off-chain engine de-risks early,
 * while the contract keeps the final hard barrier. Used by `classifyRegime`.
 */
export const DRAWDOWN_BREACH_PCT = 1.5;

/**
 * Minimum USD value of a risk position for an EmergencyDeleverage to be worth
 * executing. Below this the position is treated as dust and the cycle is
 * skipped (there is effectively nothing left to sell). Overridable via env.
 */
export const MIN_RISK_POSITION_USD = Number(process.env.MIN_RISK_POSITION_USD ?? 0.001);

/**
 * Minimum USD value of a single trade for it to be worth executing. Below this
 * the trade is pure churn — gas + Sealed Inference compute spent to move a
 * sub-cent amount (e.g. a 3% rebalance of a $0.25 vault is ~$0.0076). The
 * runner skips it before inference. Overridable via env.
 */
export const MIN_TRADE_NOTIONAL_USD = Number(process.env.MIN_TRADE_NOTIONAL_USD ?? 0.01);

/**
 * Anti-churn window. A trade that reverses the direction of the previous
 * execution within this many seconds is damped unless the regime is confirmed
 * (see ANTICHURN_REGIME_CONFIRM_CYCLES) or the drift is large (see
 * ANTICHURN_OVERRIDE_DRIFT_PP). Beyond the window, reversals are unconstrained.
 */
export const ANTICHURN_WINDOW_SEC = Number(process.env.ANTICHURN_WINDOW_SEC ?? 6 * 3600);

/**
 * Drift (percentage points off the regime target) at or above which a
 * direction-reversing trade is allowed immediately, regardless of regime
 * confirmation — a large gap is a real signal, not flap.
 */
export const ANTICHURN_OVERRIDE_DRIFT_PP = Number(process.env.ANTICHURN_OVERRIDE_DRIFT_PP ?? 5);

/**
 * Consecutive cycles a newly-observed regime must hold before it may drive a
 * direction reversal of the previous trade. Anti-flap for regime boundaries.
 */
export const ANTICHURN_REGIME_CONFIRM_CYCLES = Number(
  process.env.ANTICHURN_REGIME_CONFIRM_CYCLES ?? 2,
);

/**
 * After a defensive sell, re-entering risk immediately on the first constructive
 * regime creates the worst UX/cost pattern for small vaults: sell fast, then
 * buy back 30 minutes later because the target jumped. Defensive exits remain
 * immediate; risk re-entry must wait for a short confirmation window.
 */
export const POST_DEFENSIVE_REENTRY_DELAY_SEC = Number(
  process.env.POST_DEFENSIVE_REENTRY_DELAY_SEC ?? 2 * 3600,
);

/**
 * Consecutive cycles required before a buy can re-enter risk after an
 * EmergencyDeleverage. This confirms the new regime without touching on-chain
 * policy/cooldown thresholds.
 */
export const POST_DEFENSIVE_REENTRY_CONFIRM_CYCLES = Number(
  process.env.POST_DEFENSIVE_REENTRY_CONFIRM_CYCLES ?? 3,
);
