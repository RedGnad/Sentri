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
