// SkillMint external advisory signal client.
//
// Uses @skillmint/sdk v0.4.1 — x402 payment flow (W0G on 0G mainnet),
// receipt download from 0G Storage, and full receipt verification
// (inputHashOk + outputHashOk + teeVerified).
//
// Advisory only — failure, timeout, or unavailability MUST NOT block Sentri
// core. All public functions return null / false on any error, never throw.
//
// Security: SKILLMINT_CALLER_PRIVATE_KEY lives ONLY on Render (sentri-agent).
// NEVER expose it via NEXT_PUBLIC_* / Vercel / frontend build vars.
// Use a dedicated low-balance wallet — NOT the agent PRIVATE_KEY.
//
// SKILLMINT_REGISTRY_ADDRESS / SKILLMINT_ESCROW_ADDRESS env vars are kept
// as optional overrides for future contract migrations. They are no longer
// required since @skillmint/sdk@0.4.1 ships V3 addresses natively.

import { SkillMintClient, TESTNET, MAINNET } from "@skillmint/sdk";
import type { ReceiptVerification } from "@skillmint/sdk";

// V3 mainnet contract addresses — now matches @skillmint/sdk@0.4.1 dist/constants.js.
export const V3_MAINNET_REGISTRY = "0xdF28e06899955092DF81f0DBea03496D1Ac8904E";
export const V3_MAINNET_ESCROW   = "0xA0e5A7d722399f59A0Ee4B8DF740107FBC63f7ae";

// Reported by the installed package; update when SDK is upgraded.
const SKILLMINT_SDK_VERSION = "0.4.1";

// ── Network builder (V3 override + hard guard) ────────────────────────────

export interface SkillMintNetworkResult {
  /** Resolved network config (with any env overrides applied). */
  network: typeof MAINNET;
  usingAddressOverride: boolean;
  /** Non-null when the hard guard blocked execution. */
  guardError: string | null;
}

/**
 * Build the SkillMintClient network config, applying env var address overrides
 * and enforcing the V3 hard guard for mainnet + skill #13.
 *
 * Hard guard: if SKILLMINT_NETWORK=mainnet and SKILLMINT_SKILL_ID=13, the
 * resolved registry must equal V3_MAINNET_REGISTRY. This prevents the SDK's
 * stale V1 default from being used silently for the treasury advisory skill.
 */
export function buildSkillMintNetwork(skillIdOverride?: number): SkillMintNetworkResult {
  const isMainnet = (process.env.SKILLMINT_NETWORK ?? "mainnet") !== "testnet";
  const base = isMainnet ? MAINNET : TESTNET;
  const skillId = skillIdOverride ?? Number(process.env.SKILLMINT_SKILL_ID ?? "13");

  const registryOverride = process.env.SKILLMINT_REGISTRY_ADDRESS;
  const escrowOverride   = process.env.SKILLMINT_ESCROW_ADDRESS;
  const usingAddressOverride = !!(registryOverride || escrowOverride);

  const network = {
    ...base,
    registry: registryOverride ?? base.registry,
    escrow:   escrowOverride   ?? base.escrow,
  } as typeof MAINNET;

  // Hard guard: mainnet + skill #13 → V3 addresses required.
  if (isMainnet && skillId === 13) {
    const regOk    = network.registry.toLowerCase() === V3_MAINNET_REGISTRY.toLowerCase();
    const escrowOk = !network.escrow || network.escrow.toLowerCase() === V3_MAINNET_ESCROW.toLowerCase();
    if (!regOk || !escrowOk) {
      return {
        network,
        usingAddressOverride,
        guardError:
          "SkillMint disabled: SDK mainnet config points to legacy V1 registry " +
          `(got ${network.registry}, need ${V3_MAINNET_REGISTRY}). ` +
          "Set SKILLMINT_REGISTRY_ADDRESS and SKILLMINT_ESCROW_ADDRESS to the V3 addresses.",
      };
    }
  }

  return { network, usingAddressOverride, guardError: null };
}

// ── Healthz config snapshot ───────────────────────────────────────────────

export interface SkillMintHealthConfig {
  enabled: boolean;
  configured: boolean;
  sdkVersion: string;
  chainId: number;
  registry: string;
  escrow: string | undefined;
  skillId: number;
  usingAddressOverride: boolean;
  lastError: string | null;
}

export function getSkillMintConfig(): SkillMintHealthConfig {
  const skillId = Number(process.env.SKILLMINT_SKILL_ID ?? "13");
  const { network, usingAddressOverride, guardError } = buildSkillMintNetwork(skillId);
  return {
    enabled:              skillMintEnabled(),
    configured:           !!process.env.SKILLMINT_CALLER_PRIVATE_KEY,
    sdkVersion:           SKILLMINT_SDK_VERSION,
    chainId:              network.chainId,
    registry:             network.registry,
    escrow:               network.escrow,
    skillId,
    usingAddressOverride,
    lastError:            guardError,
  };
}

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
const _lastCallTsPerVault = new Map<string, number>();
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

export function shouldCallSkillMint(action: string, amountBps: number, vaultAddress?: string): boolean {
  if (!skillMintEnabled()) return false;
  if (action !== "Rebalance" && action !== "EmergencyDeleverage") return false;
  if (amountBps < MIN_ACTION_BPS) return false;
  _resetDailyCounterIfNeeded();
  const maxPerDay = Number(process.env.SKILLMINT_MAX_CALLS_PER_DAY ?? "24");
  if (_callsToday >= maxPerDay) return false;
  const minIntervalSec = Number(process.env.SKILLMINT_MIN_INTERVAL_SEC ?? "3600");
  const lastCallTs = vaultAddress ? (_lastCallTsPerVault.get(vaultAddress.toLowerCase()) ?? 0) : 0;
  if (lastCallTs > 0 && (Date.now() - lastCallTs) / 1000 < minIntervalSec) return false;
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
  // Vault context for richer SkillMint signal
  drawdownPct?: number;
  maxDrawdownBps?: number;
  maxAllocationBps?: number;
  oracleAgeSeconds?: number;
  regime?: string;
  hwm?: string;
}

export async function callSkillMint(input: SkillMintCallInput): Promise<SkillMintSignal | null> {
  const callerKey = process.env.SKILLMINT_CALLER_PRIVATE_KEY;
  const skillId = Number(process.env.SKILLMINT_SKILL_ID ?? "13");
  const timeoutMs = Number(process.env.SKILLMINT_TIMEOUT_MS ?? "20000");

  if (!callerKey) return null;

  const { network, guardError } = buildSkillMintNetwork(skillId);
  if (guardError) {
    console.error(`[skillmint] ${guardError}`);
    return null;
  }
  const client = new SkillMintClient({ privateKey: callerKey, network });

  const skillInput = JSON.stringify({
    action: input.action,
    amount_bps: input.amountBps,
    market_price: input.marketPrice,
    base_balance: input.baseBalance,
    risk_balance: input.riskBalance,
    tvl: input.tvl,
    high_water_mark: input.hwm,
    risk_symbol: input.riskSymbol,
    base_symbol: input.baseSymbol,
    vault: input.vaultAddress,
    drawdown_pct: input.drawdownPct,
    max_drawdown_bps: input.maxDrawdownBps,
    max_allocation_bps: input.maxAllocationBps,
    oracle_age_seconds: input.oracleAgeSeconds,
    regime: input.regime,
  });

  try {
    // executeX402 handles W0G balance check + auto-wrap + x402 payment + skill call.
    const result = await withTimeout(
      client.executeX402(skillId, skillInput),
      timeoutMs,
      "SkillMint executeX402",
    );

    if (!result.receiptRootHash) {
      console.warn("[skillmint] executeX402 returned no receiptRootHash — call succeeded but output is missing");
      return null;
    }

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
      console.warn("[skillmint] failed to parse skill output — executeX402 may have returned malformed JSON");
      return null;
    }

    _callsToday++;
    const now = Date.now();
    if (input.vaultAddress) _lastCallTsPerVault.set(input.vaultAddress.toLowerCase(), now);

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[skillmint] callSkillMint failed: ${msg}`);
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
  const isTestnet = (opts?.network ?? process.env.SKILLMINT_NETWORK ?? "mainnet") === "testnet";
  const { network } = isTestnet
    ? { network: TESTNET }
    : buildSkillMintNetwork(); // applies V3 override if env vars are set
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
