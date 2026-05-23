// SkillMint external advisory signal client.
//
// Uses @skillmint/sdk v0.4.0 — x402 payment flow (W0G on 0G testnet),
// receipt download from 0G Storage, and full receipt verification
// (inputHashOk + outputHashOk + teeVerified).
//
// Advisory only — failure, timeout, or unavailability MUST NOT block Sentri
// core. All public functions return null / false on any error, never throw.
//
// Security: SKILLMINT_CALLER_PRIVATE_KEY lives ONLY on Render (sentri-agent).
// NEVER expose it via NEXT_PUBLIC_* / Vercel / frontend build vars.
// Use a dedicated low-balance wallet — NOT the agent PRIVATE_KEY.

import { SkillMintClient, TESTNET, MAINNET } from "@skillmint/sdk";
import type { ReceiptVerification } from "@skillmint/sdk";

export type SkillMintRelation =
  | "agrees"
  | "disagrees"
  | "capped_by_sentri"
  | "rejected_by_policy"
  | "ignored";

export interface SkillMintSignal {
  provider: "skillmint";
  skillId: string;
  action: "Rebalance" | "EmergencyDeleverage" | "hold";
  amountBps: number;
  confidence: number;
  reason: string;
  receiptVerified: boolean;
  receiptRootHash: string;
  receiptStorageScanUrl: string;
  /** Full receipt verification from client.verifyReceipt(). */
  receiptVerification: ReceiptVerification | null;
  callTs: number;
  relation?: SkillMintRelation;
}

// ── In-process rate limiter ───────────────────────────────────────────────
// Resets on Render restart (~one missed interval maximum — acceptable since
// vault policy is the hard safety layer).

let _callsToday = 0;
let _lastCallTs = 0;
let _dayStartMs = _startOfDayUtcMs();

function _startOfDayUtcMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function _resetDailyCounterIfNeeded(): void {
  const today = _startOfDayUtcMs();
  if (today > _dayStartMs) {
    _dayStartMs = today;
    _callsToday = 0;
  }
}

// ── Feature flag ─────────────────────────────────────────────────────────

export function skillMintEnabled(): boolean {
  return process.env.SKILLMINT_ENABLED === "true";
}

// ── Gate: should we call SkillMint this cycle? ────────────────────────────
// Only for meaningful candidate actions — not for hold, cooldown, dust,
// market degraded, paused/killed, audit unhealthy, or signer unhealthy.
// Those gates are enforced before this function is called (agent.ts).

const MIN_ACTION_BPS = 100;

export function shouldCallSkillMint(action: string, amountBps: number): boolean {
  if (!skillMintEnabled()) return false;
  if (action !== "Rebalance" && action !== "EmergencyDeleverage") return false;
  if (amountBps < MIN_ACTION_BPS) return false;
  _resetDailyCounterIfNeeded();
  const maxPerDay = Number(process.env.SKILLMINT_MAX_CALLS_PER_DAY ?? "24");
  if (_callsToday >= maxPerDay) return false;
  const minIntervalSec = Number(process.env.SKILLMINT_MIN_INTERVAL_SEC ?? "3600");
  if (_lastCallTs > 0 && (Date.now() - _lastCallTs) / 1000 < minIntervalSec) return false;
  return true;
}

// ── Call ─────────────────────────────────────────────────────────────────

export interface SkillMintCallInput {
  vaultAddress: string;
  action: string;
  amountBps: number;
  marketPrice: number;
  baseBalance: string;
  riskBalance: string;
  tvl: string;
  riskSymbol: string;
  baseSymbol: string;
}

export async function callSkillMint(input: SkillMintCallInput): Promise<SkillMintSignal | null> {
  const callerKey = process.env.SKILLMINT_CALLER_PRIVATE_KEY;
  const skillId = Number(process.env.SKILLMINT_SKILL_ID ?? "13");
  const timeoutMs = Number(process.env.SKILLMINT_TIMEOUT_MS ?? "20000");

  if (!callerKey) return null;

  const network = process.env.SKILLMINT_NETWORK === "testnet" ? TESTNET : MAINNET;
  const client = new SkillMintClient({
    privateKey: callerKey,
    network,
  });

  const skillInput = JSON.stringify({
    action: input.action,
    amount_bps: input.amountBps,
    market_price: input.marketPrice,
    base_balance: input.baseBalance,
    risk_balance: input.riskBalance,
    tvl: input.tvl,
    risk_symbol: input.riskSymbol,
    base_symbol: input.baseSymbol,
    vault: input.vaultAddress,
  });

  try {
    // executeX402 handles W0G balance check + auto-wrap + x402 payment + skill call.
    const result = await withTimeout(
      client.executeX402(skillId, skillInput),
      timeoutMs,
      "SkillMint executeX402",
    );

    if (!result.receiptRootHash) return null;

    // Download receipt from 0G Storage and verify it end-to-end.
    let receiptVerification: ReceiptVerification | null = null;
    let receiptVerified = false;
    try {
      const receipt = await withTimeout(
        client.fetchReceipt(result.receiptRootHash),
        10_000,
        "SkillMint fetchReceipt",
      );
      const v = client.verifyReceipt(receipt);
      // verifyReceipt on a prompt skill returns ReceiptVerification (not AgentSkillReceiptVerification).
      if ("inputHashOk" in v) {
        receiptVerification = v as ReceiptVerification;
        receiptVerified = receiptVerification.valid
          && receiptVerification.inputHashOk
          && receiptVerification.outputHashOk
          && receiptVerification.teeVerified;
      }
    } catch {
      // Receipt fetch/verify failure: mark unverified, still return the signal.
    }

    // Parse skill output — expected JSON with action/amount_bps/confidence/reason.
    let action: SkillMintSignal["action"] = "hold";
    let amountBps = 0;
    let confidence = 0;
    let reason = "";
    try {
      const parsed = JSON.parse(result.output) as Record<string, unknown>;
      const rawAction = String(parsed.action ?? "hold");
      if (rawAction === "Rebalance" || rawAction === "EmergencyDeleverage") {
        action = rawAction;
      }
      amountBps = Number(parsed.amount_bps ?? 0);
      confidence = Number(parsed.confidence ?? 0);
      // Skill #13 uses short_reason; fall back to reason for other skills.
      reason = String(parsed.short_reason ?? parsed.reason ?? "");
    } catch {
      return null;
    }

    _callsToday++;
    _lastCallTs = Date.now();

    return {
      provider: "skillmint",
      skillId: String(skillId),
      action,
      amountBps,
      confidence,
      reason,
      receiptVerified,
      receiptRootHash: result.receiptRootHash,
      receiptStorageScanUrl: client.receiptUrl(result.receiptRootHash),
      receiptVerification,
      callTs: _lastCallTs,
    };
  } catch {
    return null;
  }
}

// ── Receipt-only verification (for tests / operator tooling) ─────────────

export interface ReceiptVerifyResult {
  rootHash: string;
  storageUrl: string;
  valid: boolean;
  inputHashOk: boolean;
  outputHashOk: boolean;
  teeVerified: boolean;
  error?: string;
}

export async function verifySkillMintReceipt(
  rootHash: string,
  opts?: { network?: "mainnet" | "testnet" },
): Promise<ReceiptVerifyResult> {
  const network = (opts?.network ?? process.env.SKILLMINT_NETWORK ?? "mainnet") === "testnet"
    ? TESTNET
    : MAINNET;
  const client = new SkillMintClient({
    privateKey: "0x" + "1".repeat(64), // read-only; fetchReceipt needs no signing
    network,
  });
  const storageUrl = client.receiptUrl(rootHash);
  try {
    const receipt = await withTimeout(
      client.fetchReceipt(rootHash),
      15_000,
      "verifySkillMintReceipt fetchReceipt",
    );
    const v = client.verifyReceipt(receipt);
    if (!("inputHashOk" in v)) {
      return { rootHash, storageUrl, valid: false, inputHashOk: false, outputHashOk: false, teeVerified: false, error: "unexpected receipt kind (agent-skill)" };
    }
    const rv = v as ReceiptVerification;
    return {
      rootHash,
      storageUrl,
      valid: rv.valid,
      inputHashOk: rv.inputHashOk,
      outputHashOk: rv.outputHashOk,
      teeVerified: rv.teeVerified,
    };
  } catch (err) {
    return {
      rootHash,
      storageUrl,
      valid: false,
      inputHashOk: false,
      outputHashOk: false,
      teeVerified: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Relation computation ──────────────────────────────────────────────────

export function computeSkillMintRelation(
  signal: SkillMintSignal,
  sentriAction: string,
  sentriAmountBps: number,
  regime: string,
): SkillMintRelation {
  const isSafetyRegime = regime === "crash" || regime === "drawdown_breach";
  // SkillMint recommended a buy when Sentri's policy forbids it in this regime.
  if (isSafetyRegime && signal.action === "Rebalance" && signal.amountBps > 0) {
    return "rejected_by_policy";
  }
  // Action mismatch (hold vs. active, or buy vs. sell).
  if (signal.action !== "hold" && signal.action !== sentriAction) {
    return "disagrees";
  }
  // Same direction but SkillMint asked for more than Sentri executed.
  if (signal.action === sentriAction && signal.amountBps > sentriAmountBps + 200) {
    return "capped_by_sentri";
  }
  if (signal.action === sentriAction) {
    return "agrees";
  }
  return "ignored";
}

// ── Utility ───────────────────────────────────────────────────────────────

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
