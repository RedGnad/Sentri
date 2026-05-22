import { ethers } from "ethers";
import "dotenv/config";
import {
  CHAIN,
  CONTRACTS,
  TREASURY_VAULT_ABI,
  PRICE_FEED_ABI,
  ERC20_ABI,
  VAULT_FACTORY_ABI,
  AGENT_INFT_ABI,
  AGENT,
} from "./constants.js";
import {
  initInference,
  selectProvider,
  acknowledgeProvider,
  requestInference,
  TREASURY_SYSTEM_PROMPT,
} from "./inference.js";
import { initStorage, appendAuditLog, savePortfolioState, appendRejectionLog, saveInferenceRecord } from "./storage.js";
import { getMarketSnapshot, updatePythOnChain, type MarketSnapshot } from "./market.js";
import { preflightTeeSigner, readAgentMetadata, resolveAgentTokenId } from "./agent-signer.js";
import { decodeVaultError } from "./vault-errors.js";
import { describeOutcome } from "./outcome-verdict.js";
import {
  DRAWDOWN_BREACH_PCT,
  MIN_RISK_POSITION_USD,
  MIN_TRADE_NOTIONAL_USD,
  ANTICHURN_WINDOW_SEC,
  ANTICHURN_OVERRIDE_DRIFT_PP,
  ANTICHURN_REGIME_CONFIRM_CYCLES,
} from "./strategy-constants.js";

// ── Types ─────────────────────────────────────────────────────────────────

interface AgentDecision {
  action: "Rebalance" | "YieldFarm" | "EmergencyDeleverage";
  amount_bps: number;
  rule_id?: string;
  reasoning?: string;
  short_reason?: string;
  confidence: number;
}

const ACTION_MAP: Record<string, number> = {
  Rebalance: 0,
  YieldFarm: 1,
  EmergencyDeleverage: 2,
};

/**
 * GlobalContext — singletons the agent uses across every vault iteration.
 * The factory is the source of truth for which vaults exist; the priceFeed
 * is shared across all vaults; the wallet, broker, and storage are global.
 */
/**
 * SignerHealth — whether the 0G provider's TEE signer is bound to the agent's
 * active AgentINFT. When `ok` is false, executeStrategy can only revert with
 * InvalidTEESignature, so auto-execution is gated off (no inference, no tx).
 */
export interface SignerHealth {
  /** teeSignerAddress recorded on-chain in the AgentINFT (display; "" if unresolved). */
  expectedSigner: string;
  /** TEE signer of the 0G provider the runner selected. */
  providerSigner: string;
  /** isActiveAgentWithSigner(agent, providerSigner) — the on-chain gate. */
  ok: boolean;
  /** Timestamp of the last evaluation (0 = never). */
  checkedAt: number;
}

export interface GlobalContext {
  wallet: ethers.Wallet;
  provider: ethers.JsonRpcProvider;
  factory: ethers.Contract;
  priceFeed: ethers.Contract;
  /** AgentINFT contract (read-only handle) — used to preflight the TEE-signer binding. */
  agentNFT: ethers.Contract;
  agentNFTAddress: string;
  /** Agent's INFT token id, or null if it could not be resolved (informational only). */
  agentTokenId: bigint | null;
  walletAddress: string;
  providerInfo: { address: string; model: string; endpoint: string; verifiability: string; teeSignerAddress: string };
  /** Signer-health gate state. Re-evaluated at startup and once per cycle. */
  signerHealth: SignerHealth;
}

/**
 * Re-evaluate the signer-health gate: is the selected 0G provider's TEE signer
 * bound to the agent's active AgentINFT? Mutates `ctx.signerHealth` and returns
 * the verdict. A transient RPC failure is treated as BLOCKED (fail-closed).
 *
 * Called once per cycle so the runner self-heals (resumes auto-execution) on
 * the next cycle once the binding is reconciled on-chain — no restart needed.
 */
export async function refreshSignerHealth(ctx: GlobalContext): Promise<boolean> {
  const providerSigner = ctx.providerInfo.teeSignerAddress;
  const isFirstCheck = ctx.signerHealth.checkedAt === 0;
  const prev = ctx.signerHealth.ok;

  let ok = false;
  try {
    ok = await ctx.agentNFT.isActiveAgentWithSigner(ctx.walletAddress, providerSigner);
  } catch (err) {
    log(`Signer health check failed (treating as BLOCKED for safety): ${err instanceof Error ? err.message : err}`);
    ok = false;
  }

  ctx.signerHealth = { ...ctx.signerHealth, providerSigner, ok, checkedAt: Date.now() };

  if (!isFirstCheck && ok && !prev) {
    log("Signer health RECOVERED — TEE signer reconciled on-chain. Auto-execution re-enabled.");
  }
  if (!isFirstCheck && !ok && prev) {
    log("Signer health DEGRADED — TEE signer no longer bound to the AgentINFT. Auto-execution paused.");
  }
  return ok;
}

/**
 * IterationOutcome — result of a single executeOneIterationForVault call.
 * Captured by the server for per-vault status tracking.
 */
export type IterationOutcome =
  | { status: "executed"; action: string; amountIn: string; amountOut: string; txHash: string; reasoning: string }
  | { status: "skipped"; reason: string }
  | { status: "killed"; reason: string }
  | { status: "error"; reason: string };

// ── Helpers ───────────────────────────────────────────────────────────────

export function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

type RejectionPhase = "state-read" | "estimateGas" | "executeStrategy";

interface PriceFreshness {
  answer: bigint;
  updatedAt: number;
  blockTimestamp: number;
  ageSec: number;
  maxPriceStaleness: number;
  refreshThresholdSec: number;
}

const PRICE_REFRESH_BUFFER_SEC = Number(process.env.PRICE_REFRESH_BUFFER_SEC ?? 20);

function priceRefreshThreshold(maxPriceStaleness: number): number {
  const boundedBuffer = Math.min(PRICE_REFRESH_BUFFER_SEC, Math.max(5, Math.floor(maxPriceStaleness / 4)));
  return Math.max(0, maxPriceStaleness - boundedBuffer);
}

function isPriceStaleError(err: unknown): boolean {
  return decodeVaultError(err)?.name === "PriceStale" ||
    (err instanceof Error && err.message.includes("PriceStale"));
}

function errorTxHash(err: unknown): string | undefined {
  const candidates: unknown[] = [];
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    candidates.push(e.transactionHash, e.hash);
    if (e.receipt && typeof e.receipt === "object") {
      const receipt = e.receipt as Record<string, unknown>;
      candidates.push(receipt.hash, receipt.transactionHash);
    }
    if (e.transaction && typeof e.transaction === "object") {
      candidates.push((e.transaction as Record<string, unknown>).hash);
    }
    if (e.info && typeof e.info === "object") {
      const info = e.info as Record<string, unknown>;
      if (info.receipt && typeof info.receipt === "object") {
        candidates.push((info.receipt as Record<string, unknown>).transactionHash);
      }
    }
  }
  return candidates.find((value): value is string => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value));
}

function executionFailurePhase(err: unknown): RejectionPhase {
  return errorTxHash(err) ? "executeStrategy" : "estimateGas";
}

async function readPriceFreshness(ctx: GlobalContext, maxPriceStaleness: number): Promise<PriceFreshness> {
  const [round, latestBlock] = await Promise.all([
    ctx.priceFeed.latestRoundData() as Promise<[bigint, bigint, bigint, bigint, bigint]>,
    ctx.provider.getBlock("latest"),
  ]);
  if (!latestBlock) throw new Error("latest block unavailable while checking oracle freshness");
  const updatedAt = Number(round[3]);
  const blockTimestamp = Number(latestBlock.timestamp);
  return {
    answer: BigInt(round[1]),
    updatedAt,
    blockTimestamp,
    ageSec: Math.max(0, blockTimestamp - updatedAt),
    maxPriceStaleness,
    refreshThresholdSec: priceRefreshThreshold(maxPriceStaleness),
  };
}

async function ensureFreshOracle(
  ctx: GlobalContext,
  vaultAddress: string,
  maxPriceStaleness: number,
  phase: RejectionPhase,
  action?: string,
): Promise<{ ok: true; market: MarketSnapshot | null; freshness: PriceFreshness } | { ok: false; reason: string }> {
  const before = await readPriceFreshness(ctx, maxPriceStaleness);
  if (before.answer > 0n && before.ageSec < before.refreshThresholdSec) {
    return { ok: true, market: null, freshness: before };
  }

  log(
    `Oracle age ${before.ageSec}s is near/stale for ${vaultAddress.slice(0, 10)}... ` +
      `(max ${maxPriceStaleness}s). Refreshing before ${phase}.`,
  );

  let refreshedMarket: MarketSnapshot | null = null;
  try {
    refreshedMarket = await pushPrice(ctx);
  } catch (err) {
    const reason =
      phase === "state-read"
        ? "Price refresh needed — oracle price stale, state read blocked before funds moved."
        : "Price refresh needed — oracle price stale, execution blocked before funds moved.";
    appendRejectionLog(vaultAddress, {
      timestamp: Date.now(),
      type: "onchain-revert",
      phase,
      reason,
      errorCode: "PriceStale",
      action,
      vaultAddress,
      priceAgeSec: before.ageSec,
      maxPriceStaleness,
      safeNoFundsMoved: true,
      verdict: "Blocked safely: oracle price was stale. No transaction was sent and no funds moved.",
    });
    log(`Price refresh failed before ${phase}: ${err instanceof Error ? err.message : err}`);
    return { ok: false, reason: "oracle price stale; refresh failed before funds moved" };
  }

  const after = await readPriceFreshness(ctx, maxPriceStaleness);
  if (after.answer <= 0n || after.ageSec >= after.refreshThresholdSec) {
    const reason =
      phase === "state-read"
        ? "Price refresh needed — oracle price stale, state read blocked before funds moved."
        : "Price refresh needed — oracle price stale, execution blocked before funds moved.";
    appendRejectionLog(vaultAddress, {
      timestamp: Date.now(),
      type: "onchain-revert",
      phase,
      reason,
      errorCode: "PriceStale",
      action,
      vaultAddress,
      priceAgeSec: after.ageSec,
      maxPriceStaleness,
      safeNoFundsMoved: true,
      verdict: "Blocked safely: oracle price was stale. No transaction was sent and no funds moved.",
    });
    return { ok: false, reason: "oracle price stale; refresh did not land before funds moved" };
  }

  return { ok: true, market: refreshedMarket, freshness: after };
}

function pow10(decimals: bigint | number): bigint {
  return 10n ** BigInt(decimals);
}

function quoteRiskToBase(
  riskAmount: bigint,
  price: bigint,
  feedDec: bigint | number,
  baseDec: bigint | number,
  riskDec: bigint | number,
): bigint {
  return (riskAmount * price * pow10(baseDec)) / (pow10(feedDec) * pow10(riskDec));
}

async function readTvlWithLatestPriceFallback(
  vault: ethers.Contract,
  priceFeed: ethers.Contract,
  baseBalance: bigint,
  riskBalance: bigint,
  baseDec: bigint | number,
  riskDec: bigint | number,
): Promise<{ tvl: bigint; usedFallback: boolean }> {
  try {
    return { tvl: (await vault.totalValue()) as bigint, usedFallback: false };
  } catch (err) {
    if (!isPriceStaleError(err)) throw err;
    const [round, feedDec] = await Promise.all([
      priceFeed.latestRoundData() as Promise<[bigint, bigint, bigint, bigint, bigint]>,
      priceFeed.decimals() as Promise<bigint | number>,
    ]);
    const answer = BigInt(round[1]);
    if (answer <= 0n) throw err;
    return {
      tvl: baseBalance + quoteRiskToBase(riskBalance, answer, feedDec, baseDec, riskDec),
      usedFallback: true,
    };
  }
}

function getEnvOrThrow(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

// ── Setup (run once at startup) ──────────────────────────────────────────

/**
 * Initialize everything that's shared across all vaults: wallet, factory
 * contract handle, price feed handle, 0G compute broker, 0G storage client.
 */
export async function setupGlobalContext(): Promise<GlobalContext> {
  const privateKey = getEnvOrThrow("PRIVATE_KEY");
  const factoryAddress = CONTRACTS.vaultFactory;
  const priceFeedAddress = CONTRACTS.priceFeed;

  if (!factoryAddress || factoryAddress === "0x") {
    throw new Error("VaultFactory address not configured");
  }

  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const factory = new ethers.Contract(factoryAddress, VAULT_FACTORY_ABI, wallet);
  const priceFeed = new ethers.Contract(priceFeedAddress, PRICE_FEED_ABI, wallet);

  // AgentINFT identity — the factory `agentNFT` immutable is the source of
  // truth. Used to preflight the on-chain InvalidTEESignature guard before
  // every executeStrategy. The token id is resolved via the factory's
  // `agentTokenId()` getter when available, falling back to an AgentINFT scan
  // for factory deployments that predate that getter; it is informational only
  // (the preflight gate keys on the agent address, not a token id).
  const agentNFTAddress: string = await factory.agentNFT();
  const agentNFT = new ethers.Contract(agentNFTAddress, AGENT_INFT_ABI, provider);
  let agentTokenId: bigint | null = null;
  try {
    agentTokenId = (await factory.agentTokenId()) as bigint;
  } catch {
    try {
      agentTokenId = await resolveAgentTokenId(agentNFT, wallet.address);
    } catch (err) {
      log(`AgentINFT token id resolution skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Expected on-chain TEE signer — the provider-selection target. Resolving it
  // BEFORE provider selection lets the runner pin the 0G provider whose signer
  // the AgentINFT recognises, instead of whatever provider is newest (0G's
  // registry changes over time, which silently breaks the on-chain binding).
  // An explicit SENTRI_EXPECTED_TEE_SIGNER env wins over the on-chain read.
  let expectedTeeSigner = process.env.SENTRI_EXPECTED_TEE_SIGNER?.trim() ?? "";
  if (!expectedTeeSigner && agentTokenId !== null) {
    try {
      const meta = await readAgentMetadata(agentNFT, agentTokenId);
      expectedTeeSigner = meta.teeSignerAddress;
    } catch (err) {
      log(`Expected TEE signer read skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  log("Initializing 0G Sealed Inference broker...");
  await initInference(privateKey);

  log("Selecting inference provider...");
  if (expectedTeeSigner) log(`Targeting expected on-chain TEE signer: ${expectedTeeSigner}`);
  const providerInfo = await selectProvider(expectedTeeSigner || undefined);
  log(
    `Provider: ${providerInfo.address} | Model: ${providerInfo.model} | ` +
      `Verifiability: ${providerInfo.verifiability} | TEE signer: ${providerInfo.teeSignerAddress}`,
  );

  log("Acknowledging provider TEE signer...");
  await acknowledgeProvider();

  log("Initializing 0G Storage...");
  initStorage(privateKey);

  log(`Agent ready. Wallet: ${wallet.address}`);
  log(`Factory: ${factoryAddress}`);
  log(`AgentINFT: ${agentNFTAddress} | token #${agentTokenId ?? "unknown"}`);

  const ctx: GlobalContext = {
    wallet,
    provider,
    factory,
    priceFeed,
    agentNFT,
    agentNFTAddress,
    agentTokenId,
    walletAddress: wallet.address,
    providerInfo,
    signerHealth: {
      expectedSigner: expectedTeeSigner,
      providerSigner: providerInfo.teeSignerAddress,
      ok: false,
      checkedAt: 0,
    },
  };

  // Hard signer-health gate (P2). Evaluate the on-chain InvalidTEESignature
  // binding at boot: if the selected provider's TEE signer is not bound to the
  // agent's active AgentINFT, auto-execution stays disabled until reconciled.
  const healthy = await refreshSignerHealth(ctx);
  if (healthy) {
    log(`Signer health OK — provider TEE signer is bound to the active AgentINFT.`);
  } else {
    log("BLOCKED_SIGNER_HEALTH");
    log(`  Expected on-chain signer: ${ctx.signerHealth.expectedSigner || "(unresolved)"}`);
    log(`  Current provider signer:  ${ctx.signerHealth.providerSigner}`);
    log("  Status: BLOCKED — auto-execution disabled (TEE signer mismatch).");
    log("  Vault creation and deposits are unaffected. Funds are safe.");
    log("  Operator action required — see docs/operator-signer-mismatch.md.");
  }

  return ctx;
}

// ── Vault discovery ──────────────────────────────────────────────────────

/**
 * Read the factory's vault registry. Called every cycle so newly-created
 * vaults are picked up automatically.
 */
export async function discoverVaults(ctx: GlobalContext): Promise<string[]> {
  const count: bigint = await ctx.factory.vaultsCount();
  const n = Number(count);
  if (n === 0) return [];
  // Read in pages of 50 to avoid deep multicall depth on large registries.
  const PAGE = 50;
  const vaults: string[] = [];
  for (let start = 0; start < n; start += PAGE) {
    const page: string[] = await ctx.factory.vaultsPage(start, PAGE);
    vaults.push(...page);
  }
  return vaults;
}

// ── Price feed (pushed once per cycle) ───────────────────────────────────

/**
 * Push the latest risk/base price to the on-chain oracle. Done once at the
 * start of each cycle so all vault iterations use the same fresh price.
 */
export async function pushPrice(ctx: GlobalContext): Promise<MarketSnapshot> {
  const market = await getMarketSnapshot();
  log(
    `Market: ${market.riskSymbol}=$${market.priceUsd.toFixed(4)} · 24h ${market.change24h.toFixed(2)}% · ` +
      `${market.sourceCount} sources · spread ${market.spreadPct.toFixed(3)}% · ${market.health} · ${market.source}`,
  );

  const feedDecimals: bigint = await ctx.priceFeed.decimals();
  const answer = BigInt(Math.floor(market.priceUsd * 10 ** Number(feedDecimals)));
  const priceAttestationPayload = {
    medianPrice: market.priceUsd,
    sourceCount: market.sourceCount,
    spreadPct: market.spreadPct,
    sources: market.rawSources,
    timestamp: market.timestamp,
  };
  const attestation = ethers.keccak256(
    ethers.toUtf8Bytes(canonicalJson(priceAttestationPayload)),
  );

  try {
    const tx = await ctx.priceFeed.pushAnswer(answer, attestation);
    await tx.wait();
    log(`Price pushed on-chain: answer=${answer} (att=${attestation.slice(0, 10)}...)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("NotKeeper") || msg.includes("0xf7f0e693")) {
      log("Agent is not a registered keeper on SentriPriceFeed. Skipping price push.");
    } else {
      throw err;
    }
  }
  return market;
}

// ── One iteration on one vault ───────────────────────────────────────────

/**
 * Executes a single decision cycle on a specific vault: read vault state →
 * build prompt → TEE inference → execute on-chain → write audit + state.
 *
 * Throws are caught at the call site (server.ts) so a failure on one vault
 * never breaks the cycle for others.
 */
export async function executeOneIterationForVault(
  ctx: GlobalContext,
  vaultAddress: string,
  market: MarketSnapshot,
): Promise<IterationOutcome> {
  const vault = new ethers.Contract(vaultAddress, TREASURY_VAULT_ABI, ctx.wallet);
  let activeMarket = market;

  const isKilled: boolean = await vault.killed();
  if (isKilled) {
    return { status: "killed", reason: "vault is killed" };
  }
  const isPaused: boolean = await vault.paused();
  if (isPaused) {
    return { status: "skipped", reason: "vault is paused" };
  }

  // Read full vault state
  const [baseAddr, riskAddr, baseBalance, riskBalance, hwm, policy, logCount, lastExecutionTime] =
    await Promise.all([
      vault.base(),
      vault.risk(),
      vault.vaultBalance(),
      vault.riskBalance(),
      vault.highWaterMark(),
      vault.policy(),
      vault.executionLogCount(),
      vault.lastExecutionTime(),
    ]);

  const baseToken = new ethers.Contract(baseAddr, ERC20_ABI, ctx.wallet);
  const riskToken = new ethers.Contract(riskAddr, ERC20_ABI, ctx.wallet);
  const [baseDec, riskDec] = await Promise.all([baseToken.decimals(), riskToken.decimals()]);
  const policySnapshot = {
    maxAllocationBps: Number(policy[0]),
    maxDrawdownBps: Number(policy[1]),
    rebalanceThresholdBps: Number(policy[2]),
    maxSlippageBps: Number(policy[3]),
    cooldownPeriod: Number(policy[4]),
    maxPriceStaleness: Number(policy[5]),
  };

  const stateFreshness = await ensureFreshOracle(
    ctx,
    vaultAddress,
    policySnapshot.maxPriceStaleness,
    "state-read",
  );
  if (!stateFreshness.ok) {
    return { status: "skipped", reason: stateFreshness.reason };
  }
  if (stateFreshness.market) activeMarket = stateFreshness.market;

  let tvl: bigint;
  try {
    tvl = (await vault.totalValue()) as bigint;
  } catch (err) {
    if (!isPriceStaleError(err)) throw err;
    const freshness = await readPriceFreshness(ctx, policySnapshot.maxPriceStaleness);
    appendRejectionLog(vaultAddress, {
      timestamp: Date.now(),
      type: "onchain-revert",
      phase: "state-read",
      reason: "Price refresh needed — oracle price stale, state read blocked before funds moved.",
      errorCode: "PriceStale",
      vaultAddress,
      priceAgeSec: freshness.ageSec,
      maxPriceStaleness: policySnapshot.maxPriceStaleness,
      safeNoFundsMoved: true,
      verdict: "Blocked safely: oracle price was stale. No transaction was sent and no funds moved.",
    });
    return { status: "skipped", reason: "oracle price stale during state read; no funds moved" };
  }

  const baseStr = ethers.formatUnits(baseBalance, baseDec);
  const riskStr = ethers.formatUnits(riskBalance, riskDec);
  let tvlStr = ethers.formatUnits(tvl, baseDec);
  const hwmStr = ethers.formatUnits(hwm, baseDec);
  const baseSymbol = activeMarket.baseSymbol ?? "USDC";
  const riskSymbol = activeMarket.riskSymbol ?? "ETH";

  log(
    `Vault ${vaultAddress.slice(0, 10)}...: ${baseStr} ${baseSymbol} + ${riskStr} ${riskSymbol} | ` +
      `TVL ${tvlStr} | HWM ${hwmStr} | logs ${logCount}`,
  );

  if (tvl === 0n) {
    return { status: "skipped", reason: "vault is empty" };
  }

  if (activeMarket.tradingAllowed === false) {
    return {
      status: "skipped",
      reason:
        `market health ${activeMarket.health}; ${riskSymbol} trading requires Jaine on-chain price plus external sanity check. ` +
        `Sources: ${activeMarket.source}. Failures: ${activeMarket.failures.join(" | ") || "none"}`,
    };
  }

  const { prompt, recommendation } = buildMarketPrompt({
    baseBalance: baseStr,
    riskBalance: riskStr,
    tvl: tvlStr,
    hwm: hwmStr,
    market: activeMarket,
    policy: {
      maxAllocationBps: policySnapshot.maxAllocationBps,
      maxDrawdownBps: policySnapshot.maxDrawdownBps,
      rebalanceThresholdBps: policySnapshot.rebalanceThresholdBps,
      maxSlippageBps: policySnapshot.maxSlippageBps,
      cooldownPeriod: policySnapshot.cooldownPeriod,
    },
  });

  log(
    `Recommendation: regime=${recommendation.regime} target=${recommendation.targetShare}% ` +
      `action=${recommendation.recommendedAction} amount_bps=${recommendation.recommendedAmountBps}`,
  );

  // Track regime persistence every cycle (even on a hold) so the anti-churn
  // guard below can tell a confirmed regime change from boundary flap.
  const regimeObservations = recordRegimeObservation(vaultAddress, recommendation.regime);

  if (
    recommendation.recommendedAction === "EmergencyDeleverage" &&
    Number(riskStr) * activeMarket.priceUsd < MIN_RISK_POSITION_USD
  ) {
    return { status: "skipped", reason: `risk position below dust threshold (${MIN_RISK_POSITION_USD} ${baseSymbol})` };
  }

  if (recommendation.recommendedAmountBps === 0) {
    return { status: "skipped", reason: "no action needed (deterministic hold)" };
  }

  if (recommendation.recommendedAction === "Rebalance") {
    const currentRiskValue = Number(riskStr) * activeMarket.priceUsd;
    const maxRiskValue = Number(tvlStr) * policySnapshot.maxAllocationBps / 10000;
    const remainingRiskHeadroom = Math.max(0, maxRiskValue - currentRiskValue);
    const maxBaseIn = ethers.parseUnits(remainingRiskHeadroom.toFixed(Number(baseDec)), baseDec);
    if (maxBaseIn === 0n) {
      return { status: "skipped", reason: `no remaining ${riskSymbol} exposure headroom` };
    }
  }

  // Cooldown gate (pre-LLM). TreasuryVault enforces `cooldownPeriod` on-chain —
  // executeStrategy reverts with CooldownNotElapsed inside the window. Mirror
  // that read-only here, BEFORE Sealed Inference, so a cycle that lands inside
  // the cooldown window costs no inference call and no durable KV write that
  // could only end in a rejected transaction. The contract stays the hard
  // guard (a boundary cycle that slips through is still caught by the on-chain
  // revert handler); this is purely an efficiency gate. Nothing is sent on
  // chain; funds are never at risk. lastExecutionTime == 0 means the vault has
  // never executed — no cooldown applies.
  if (lastExecutionTime > 0n && policySnapshot.cooldownPeriod > 0) {
    const elapsedSec = Math.floor(Date.now() / 1000) - Number(lastExecutionTime);
    if (elapsedSec < policySnapshot.cooldownPeriod) {
      const remainingSec = policySnapshot.cooldownPeriod - elapsedSec;
      log(
        `Cooldown active for ${vaultAddress.slice(0, 10)}... — ${remainingSec}s remaining; ` +
          "skipping before Sealed Inference (no inference call, no tx).",
      );
      return {
        status: "skipped",
        reason: `cooldown active — ${remainingSec}s remaining before next action`,
      };
    }
  }

  // Anti-churn guard (pre-LLM). Deterministic, reproducible off-chain. Skips a
  // trade that is either sub-economic in size or a small reversal of a recent
  // trade during regime-boundary flap — before spending Sealed Inference on it.
  // Safety regimes (drawdown_breach, crash) bypass it inside evaluateAntiChurn.
  // Touches no on-chain policy threshold; the contract stays the hard guard.
  {
    const currentShare =
      Number(tvlStr) > 0
        ? (Number(riskStr) * activeMarket.priceUsd) / Number(tvlStr) * 100
        : 0;
    const tradeValueUsd =
      recommendation.recommendedAction === "EmergencyDeleverage"
        ? Number(riskStr) * (recommendation.recommendedAmountBps / 10000) * activeMarket.priceUsd
        : Number(baseStr) * (recommendation.recommendedAmountBps / 10000);
    const secondsSinceLastExecution =
      lastExecutionTime > 0n ? Math.floor(Date.now() / 1000) - Number(lastExecutionTime) : null;

    // The last on-chain action is only needed when a recent execution could be
    // reversed — read it lazily to avoid an RPC call on the common path.
    let lastExecutedAction: number | null = null;
    if (
      logCount > 0n &&
      secondsSinceLastExecution !== null &&
      secondsSinceLastExecution < ANTICHURN_WINDOW_SEC
    ) {
      try {
        const lastLog = await vault.executionLogs(logCount - 1n);
        lastExecutedAction = Number(lastLog[1]);
      } catch {
        lastExecutedAction = null; // best-effort — the reversal check just stays inert
      }
    }

    const churn = evaluateAntiChurn({
      recommendedAction: recommendation.recommendedAction,
      tradeValueUsd,
      regime: recommendation.regime,
      driftPp: Math.abs(currentShare - recommendation.targetShare),
      lastExecutedAction,
      secondsSinceLastExecution,
      regimeObservations,
    });
    if (churn.block) {
      log(`Anti-churn skip for ${vaultAddress.slice(0, 10)}... — ${churn.reason}`);
      return { status: "skipped", reason: churn.reason ?? "anti-churn hold" };
    }
  }

  log("Requesting Sealed Inference (TEE)...");
  const inference = await requestInference(prompt, TREASURY_SYSTEM_PROMPT);
  log(
    `TEE verified: ${inference.verified} | ChatID: ${inference.chatID} | ` +
      `Signer: ${inference.teeSignerAddress}`,
  );

  // Preflight the vault's InvalidTEESignature guard (TreasuryVault._verifyTEE):
  // executeStrategy reverts with InvalidTEESignature (selector 0x4c0f9589) when
  // the recovered TEE signer is not bound to the agent's active AgentINFT.
  // Mirror that check read-only here — before estimateGas / executeStrategy —
  // so a signer mismatch becomes a clean operator-actionable skip instead of an
  // opaque "execution reverted (unknown custom error)". Nothing is sent on
  // chain; funds are never at risk.
  const preflight = await preflightTeeSigner(
    ctx.agentNFT,
    ctx.walletAddress,
    ctx.agentNFTAddress,
    ctx.agentTokenId,
    inference.recoveredSignerAddress,
  );
  if (!preflight.ok) {
    log("SKIPPED_TEE_SIGNER_MISMATCH");
    log(`  Recovered signer:        ${preflight.recoveredSigner}`);
    log(`  Expected/onchain signer: ${preflight.expectedSigner}`);
    log(`  Agent address:           ${preflight.agentAddress}`);
    log(`  Agent token id:          ${preflight.agentTokenId}`);
    log(`  Vault:                   ${vaultAddress}`);
    log("  Funds safe. Operator action required.");
    log(
      "Execution blocked: recovered TEE signer is not bound to the active AgentINFT. " +
        "Funds are safe.",
    );
    appendRejectionLog(vaultAddress, {
      timestamp: Date.now(),
      type: "tee-signer-mismatch",
      reason:
        "Execution blocked: recovered TEE signer is not bound to the active AgentINFT. " +
        `Recovered ${preflight.recoveredSigner}, AgentINFT expects ${preflight.expectedSigner}. ` +
        "Funds are safe — operator must reconcile the runner/provider config or rotate the " +
        "AgentINFT signer (see docs/operator-signer-mismatch.md).",
      errorCode: "InvalidTEESignature",
      action: recommendation.recommendedAction,
      vaultAddress,
    });
    return {
      status: "skipped",
      reason:
        "TEE signer not bound to active AgentINFT — operator action required " +
        "(SKIPPED_TEE_SIGNER_MISMATCH)",
    };
  }

  let decision: AgentDecision;
  try {
    decision = parseAgentDecision(inference.modelResponse);
  } catch {
    return { status: "skipped", reason: `invalid JSON from LLM: ${inference.modelResponse.slice(0, 120)}` };
  }
  const validationError = validateDecision(decision);
  if (validationError) return { status: "skipped", reason: validationError };
  const reasoning = decision.short_reason ?? decision.reasoning ?? "";
  const confidenceScore = Math.min(decision.confidence, 95);
  log(`Decision: ${decision.action} | ${decision.amount_bps}bps | score ${confidenceScore}%`);
  log(`Reasoning: ${reasoning}`);

  // Defensive verifier: the LLM is allowed to be MORE cautious than the
  // deterministic recommendation, never less. Reject overrides that lean
  // risk-on relative to the matrix. This makes the "AI as defensive
  // verifier" claim verifiable in the call path, not just in the prompt.
  const validation = validateAgainstRecommendation(decision, recommendation);
  if (!validation.ok) {
    log(`LLM override rejected (defensive contract violated): ${validation.reason}`);
    appendRejectionLog(vaultAddress, {
      timestamp: Date.now(),
      type: "defensive-override",
      reason: `Defensive override violation: ${validation.reason}`,
      action: decision.action,
      vaultAddress,
    });
    return { status: "skipped", reason: `defensive override violation: ${validation.reason}` };
  }

  if (decision.amount_bps === 0) {
    return { status: "skipped", reason: "no action needed (amount_bps=0)" };
  }

  const executionFreshness = await ensureFreshOracle(
    ctx,
    vaultAddress,
    policySnapshot.maxPriceStaleness,
    "executeStrategy",
    decision.action,
  );
  if (!executionFreshness.ok) {
    return { status: "skipped", reason: executionFreshness.reason };
  }
  if (executionFreshness.market) {
    activeMarket = executionFreshness.market;
    tvl = (await vault.totalValue()) as bigint;
    tvlStr = ethers.formatUnits(tvl, baseDec);
  }

  // Size the order
  let amountIn: bigint;
  if (decision.action === "EmergencyDeleverage") {
    amountIn = (BigInt(riskBalance) * BigInt(decision.amount_bps)) / 10000n;
    if (amountIn === 0n) return { status: "skipped", reason: "no risk balance to deleverage" };
  } else {
    amountIn = (BigInt(baseBalance) * BigInt(decision.amount_bps)) / 10000n;
    if (amountIn === 0n) return { status: "skipped", reason: "no base balance to allocate" };
    const currentRiskValue = Number(riskStr) * activeMarket.priceUsd;
    const maxRiskValue = Number(tvlStr) * policySnapshot.maxAllocationBps / 10000;
    const remainingRiskHeadroom = Math.max(0, maxRiskValue - currentRiskValue);
    const maxBaseIn = ethers.parseUnits(remainingRiskHeadroom.toFixed(Number(baseDec)), baseDec);
    if (maxBaseIn === 0n) return { status: "skipped", reason: `no remaining ${riskSymbol} exposure headroom` };
    if (amountIn > maxBaseIn) {
      log(
        `Capping amount from ${ethers.formatUnits(amountIn, baseDec)} to ` +
          `${ethers.formatUnits(maxBaseIn, baseDec)} based on remaining ${riskSymbol} exposure headroom`,
      );
      amountIn = maxBaseIn;
    }
  }

  const deadline = Math.floor(Date.now() / 1000) + 300;
  const intent = {
    chainId: CHAIN.id,
    vault: vaultAddress,
    agent: ctx.walletAddress,
    provider: inference.provider,
    model: inference.model,
    verifiability: inference.verifiability,
    teeSigner: inference.teeSignerAddress,
    chatID: inference.chatID,
    responseHash: inference.responseHash,
    action: decision.action,
    amountIn: amountIn.toString(),
    price: activeMarket.priceUsd,
    priceSource: activeMarket.source,
    policySnapshot,
    deadline,
  };
  const intentHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalJson(intent)));
  const priceAttestationPayload = {
    medianPrice: activeMarket.priceUsd,
    sourceCount: activeMarket.sourceCount,
    spreadPct: activeMarket.spreadPct,
    sources: activeMarket.rawSources,
    timestamp: activeMarket.timestamp,
  };

  const formattedAmountIn =
    decision.action === "EmergencyDeleverage"
      ? ethers.formatUnits(amountIn, riskDec)
      : ethers.formatUnits(amountIn, baseDec);

  try {
    await saveInferenceRecord(vaultAddress, {
      schema: "sentri.inference.v1",
      timestamp: Date.now(),
      vaultAddress,
      logIndex: Number(logCount),
      action: decision.action,
      amount: formattedAmountIn,
      amountIn: amountIn.toString(),
      intent,
      intentHash,
      responseHash: inference.responseHash,
      rawResponseHash: inference.rawResponseHash,
      signedPayloadHash: inference.signedPayloadHash,
      modelResponse: inference.modelResponse,
      signedResponse: inference.signedResponse,
      teeSignature: inference.teeSignature,
      teeSigner: inference.teeSignerAddress,
      recoveredSigner: inference.recoveredSignerAddress,
      expectedSigner: inference.teeSignerAddress,
      signerMatchedProvider: inference.recoveredSignerAddress.toLowerCase() === inference.teeSignerAddress.toLowerCase(),
      teeAttestation: inference.teeAttestation,
      deadline,
      processResponseVerified: inference.processResponseVerified,
      verified: inference.verified,
      provider: inference.provider,
      providerEndpoint: inference.endpoint,
      model: inference.model,
      verifiability: inference.verifiability,
      chatID: inference.chatID,
      reasoning,
      confidence: confidenceScore,
      marketPrice: activeMarket.priceUsd,
      marketSource: activeMarket.source,
      marketSpreadPct: activeMarket.spreadPct,
      marketSourceCount: activeMarket.sourceCount,
      marketRequiredSourceCount: activeMarket.requiredSourceCount,
      marketRawSources: activeMarket.rawSources,
      priceAttestationPayload,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`SKIPPED_AUDIT_STORAGE: durable inference record write failed: ${message}`);
    await appendRejectionLog(vaultAddress, {
      timestamp: Date.now(),
      type: "audit-storage",
      reason:
        "Audit persistence unavailable — TEE reasoning could not be written to durable storage, " +
        "so execution was blocked before funds moved.",
      errorCode: "AuditStorageUnavailable",
      action: decision.action,
      intentHash,
      vaultAddress,
      safeNoFundsMoved: true,
      verdict:
        "Blocked safely: TEE reasoning was not durably indexed, so no transaction was sent and no funds moved.",
    });
    return { status: "skipped", reason: "audit persistence unavailable; no funds moved" };
  }

  const finalFreshness = await ensureFreshOracle(
    ctx,
    vaultAddress,
    policySnapshot.maxPriceStaleness,
    "executeStrategy",
    decision.action,
  );
  if (!finalFreshness.ok) {
    return { status: "skipped", reason: finalFreshness.reason };
  }

  // Execute. Keep this try/catch scoped only to executeStrategy so post-tx
  // bookkeeping failures cannot be misreported as blocked actions.
  let receipt: ethers.TransactionReceipt;
  try {
    const tx = await vault.executeStrategy(
      ACTION_MAP[decision.action],
      amountIn,
      intentHash,
      inference.signedResponse,
      inference.teeSignature,
      inference.teeAttestation,
      deadline,
    );
    const waited = await tx.wait();
    if (!waited) throw new Error("executeStrategy transaction was sent but no receipt was returned");
    receipt = waited;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Custom-error selectors = keccak256("Name()")[:4] (verified via ethers.id).
    const COOLDOWN = "0xa22b745e";    // CooldownNotElapsed()
    const ALLOCATION = "0x74a5d1f5";  // AllocationExceeded()
    const DRAWDOWN = "0x897b3413";    // DrawdownBreached()
    const STALE = "PriceStale";
    const mkRejection = async (reason: string, errorCode: string) => {
      const txHash = errorTxHash(err);
      let priceAgeSec: number | undefined;
      let maxPriceStaleness: number | undefined;
      if (errorCode === "PriceStale") {
        try {
          const freshness = await readPriceFreshness(ctx, policySnapshot.maxPriceStaleness);
          priceAgeSec = freshness.ageSec;
          maxPriceStaleness = freshness.maxPriceStaleness;
        } catch {
          maxPriceStaleness = policySnapshot.maxPriceStaleness;
        }
      }
      appendRejectionLog(vaultAddress, {
        timestamp: Date.now(),
        type: "onchain-revert",
        phase: executionFailurePhase(err),
        reason,
        errorCode,
        action: decision.action,
        intentHash,
        txHash,
        priceAgeSec,
        maxPriceStaleness,
        safeNoFundsMoved: true,
        verdict: txHash
          ? "Blocked safely: transaction reverted on-chain. No funds moved."
          : "Blocked safely: no transaction was sent and no funds moved.",
        vaultAddress,
      });
    };
    if (msg.includes("CooldownNotElapsed") || msg.includes(COOLDOWN)) {
      await mkRejection("On-chain revert: cooldown not elapsed", "CooldownNotElapsed");
      return { status: "skipped", reason: "cooldown not elapsed" };
    } else if (msg.includes("AllocationExceeded") || msg.includes(ALLOCATION)) {
      await mkRejection("On-chain revert: allocation cap exceeded", "AllocationExceeded");
      return { status: "skipped", reason: "allocation exceeded" };
    } else if (msg.includes("DrawdownBreached") || msg.includes(DRAWDOWN)) {
      await mkRejection("On-chain revert: drawdown bound breached", "DrawdownBreached");
      return { status: "skipped", reason: "drawdown breached" };
    } else if (msg.includes(STALE)) {
      await mkRejection("On-chain revert: oracle price stale", "PriceStale");
      return { status: "skipped", reason: "oracle price stale" };
    } else if (msg.includes("InsufficientAmountOut")) {
      await mkRejection("On-chain revert: swap slippage guard triggered", "InsufficientAmountOut");
      return { status: "skipped", reason: "swap reverted on slippage guard" };
    } else if (msg.includes("VaultKilled")) {
      await mkRejection("On-chain revert: vault killed", "VaultKilled");
      return { status: "killed", reason: "vault killed mid-iteration" };
    }

    // Fallback: decode any other Sentri custom-error selector so an opaque
    // "execution reverted (unknown custom error)" becomes a named, actionable
    // outcome. This also catches InvalidTEESignature (0x4c0f9589) in the rare
    // case the AgentINFT binding changed between preflight and execution.
    const decoded = decodeVaultError(err);
    if (decoded) {
      log(`On-chain revert decoded: ${decoded.name} (${decoded.selector}) — ${decoded.message}`);
      await mkRejection(`On-chain revert: ${decoded.name} — ${decoded.message}`, decoded.name);
      if (decoded.name === "InvalidTEESignature") {
        log(
          "Execution blocked: recovered TEE signer is not bound to the active AgentINFT. " +
            "Funds are safe. Operator action required (see docs/operator-signer-mismatch.md).",
        );
      }
      if (decoded.name === "VaultKilled") {
        return { status: "killed", reason: "vault killed mid-iteration" };
      }
      return { status: "skipped", reason: `on-chain revert: ${decoded.name}` };
    }

    throw err; // re-throw genuinely unknown errors so the server logs them
  }

  // Use chain block timestamp × 1000 for the audit cache key so the dashboard
  // (which reads executionLogs[].timestamp from chain and queries by × 1000)
  // gets a deterministic match.
  const execBlock = await receipt.getBlock();
  const chainTimestampMs = Number(execBlock.timestamp) * 1000;

  // Determine actual amounts from the latest log.
  const idx = (await vault.executionLogCount()) - 1n;
  const latestLog = await vault.executionLogs(idx);
  const amountOut = latestLog[3] as bigint;
  const formattedAmountOut =
    decision.action === "EmergencyDeleverage"
      ? ethers.formatUnits(amountOut, baseDec)
      : ethers.formatUnits(amountOut, riskDec);

  log(`TX confirmed: ${receipt.hash}. Saving audit + state to 0G Storage...`);

  try {
    await appendAuditLog(vaultAddress, {
      timestamp: chainTimestampMs,
      logIndex: Number(idx),
      action: decision.action,
      amount: formattedAmountIn,
      intent,
      intentHash,
      responseHash: inference.responseHash,
      rawResponseHash: inference.rawResponseHash,
      signedPayloadHash: inference.signedPayloadHash,
      modelResponse: inference.modelResponse,
      signedResponse: inference.signedResponse,
      teeSignature: inference.teeSignature,
      teeSigner: inference.teeSignerAddress,
      recoveredSigner: inference.recoveredSignerAddress,
      expectedSigner: inference.teeSignerAddress,
      signerMatchedProvider: inference.recoveredSignerAddress.toLowerCase() === inference.teeSignerAddress.toLowerCase(),
      teeAttestation: inference.teeAttestation,
      deadline,
      processResponseVerified: inference.processResponseVerified,
      verified: inference.verified,
      provider: inference.provider,
      providerEndpoint: inference.endpoint,
      model: inference.model,
      verifiability: inference.verifiability,
      chatID: inference.chatID,
      reasoning,
      confidence: confidenceScore,
      txHash: receipt.hash,
      marketPrice: activeMarket.priceUsd,
      marketSource: activeMarket.source,
      marketSpreadPct: activeMarket.spreadPct,
      marketSourceCount: activeMarket.sourceCount,
      marketRequiredSourceCount: activeMarket.requiredSourceCount,
      marketRawSources: activeMarket.rawSources,
      priceAttestationPayload,
    });
  } catch (err) {
    log(
      `Post-execution audit write failed for ${vaultAddress.slice(0, 10)}... ` +
        `after confirmed tx ${receipt.hash}: ${err instanceof Error ? err.message : err}`,
    );
  }

  try {
    const [newBase, newRisk, newHwm, newLogCount] = await Promise.all([
      vault.vaultBalance() as Promise<bigint>,
      vault.riskBalance() as Promise<bigint>,
      vault.highWaterMark() as Promise<bigint>,
      vault.executionLogCount() as Promise<bigint>,
    ]);
    const { tvl: newTvl, usedFallback } = await readTvlWithLatestPriceFallback(
      vault,
      ctx.priceFeed,
      newBase,
      newRisk,
      baseDec,
      riskDec,
    );
    if (usedFallback) {
      log(
        `Post-execution portfolio refresh used latest-price fallback for ${vaultAddress.slice(0, 10)}... ` +
          `after confirmed tx ${receipt.hash}; no rejection logged.`,
      );
    }

    await savePortfolioState(vaultAddress, {
      vaultBalance: ethers.formatUnits(newBase, baseDec),
      riskBalance: ethers.formatUnits(newRisk, riskDec),
      totalValue: ethers.formatUnits(newTvl, baseDec),
      highWaterMark: ethers.formatUnits(newHwm, baseDec),
      lastAction: decision.action,
      lastActionTime: Date.now(),
      totalExecutions: Number(newLogCount),
      pnlBps: newHwm > 0n ? Number(((newTvl - newHwm) * 10000n) / newHwm) : 0,
      marketPrice: activeMarket.priceUsd,
    });
  } catch (err) {
    log(
      `Post-execution portfolio refresh failed for ${vaultAddress.slice(0, 10)}... ` +
        `after confirmed tx ${receipt.hash}; execution remains confirmed: ${err instanceof Error ? err.message : err}`,
    );
  }

  return {
    status: "executed",
    action: decision.action,
    amountIn: formattedAmountIn,
    amountOut: formattedAmountOut,
    txHash: receipt.hash,
    reasoning,
  };
}

function validateDecision(decision: AgentDecision): string | null {
  if (!Object.hasOwn(ACTION_MAP, decision.action)) return `invalid action from LLM: ${String(decision.action)}`;
  if (!Number.isInteger(decision.amount_bps) || decision.amount_bps < 0 || decision.amount_bps > 10000) {
    return `invalid amount_bps from LLM: ${String(decision.amount_bps)}`;
  }
  if (!Number.isInteger(decision.confidence) || decision.confidence < 0 || decision.confidence > 100) {
    return `invalid confidence from LLM: ${String(decision.confidence)}`;
  }
  return null;
}

function parseAgentDecision(raw: string): AgentDecision {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const text = fenced?.[1]?.trim() ?? trimmed;
  return JSON.parse(text) as AgentDecision;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// ── Multi-vault standalone loop (for `pnpm agent` CLI) ───────────────────

export async function runMultiVaultLoop(): Promise<void> {
  const ctx = await setupGlobalContext();
  log("Starting multi-vault loop.\n");

  while (true) {
    try {
      // Hard signer-health gate (P2): skip the whole cycle — no price push, no
      // inference, no executeStrategy — while the provider TEE signer is not
      // bound to the AgentINFT. Re-evaluated each cycle so the loop self-heals.
      if (!(await refreshSignerHealth(ctx))) {
        log(
          `BLOCKED_SIGNER_HEALTH — auto-execution disabled (TEE signer mismatch). ` +
            `expected=${ctx.signerHealth.expectedSigner || "(unresolved)"} ` +
            `provider=${ctx.signerHealth.providerSigner}. Funds are safe; ` +
            `see docs/operator-signer-mismatch.md.`,
        );
        log(`Sleeping ${AGENT.cycleIntervalMs / 1000}s until next cycle...\n`);
        await new Promise((r) => setTimeout(r, AGENT.cycleIntervalMs));
        continue;
      }

      const market = await pushPrice(ctx);
      const vaults = await discoverVaults(ctx);
      log(`Cycle: ${vaults.length} vault(s) tracked`);

      for (const vaultAddr of vaults) {
        try {
          const outcome = await executeOneIterationForVault(ctx, vaultAddr, market);
          log(`  ${vaultAddr.slice(0, 10)}... → ${outcome.status} — ${describeOutcome(outcome).text}`);
        } catch (err) {
          log(`  ${vaultAddr.slice(0, 10)}... → ERROR: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      log(`Cycle error: ${err instanceof Error ? err.message : err}`);
    }

    log(`Sleeping ${AGENT.cycleIntervalMs / 1000}s until next cycle...\n`);
    await new Promise((r) => setTimeout(r, AGENT.cycleIntervalMs));
  }
}

/**
 * Strategy regime classifier.
 *
 * Sentri v2 uses a vol-adjusted regime-aware target rather than a fixed 25%
 * anchor. The classifier maps three live signals to a regime label:
 *
 * - drawdown_from_HWM (capital preservation)
 * - 24h price change   (directional momentum)
 * - oracle spread      (Pyth vs Jaine on-chain — disagreement = stress proxy)
 *
 * Regime labels are evaluated in order; first match wins. This mirrors the
 * institutional "vol-targeting" pattern documented as 2026 best practice for
 * AI-managed crypto treasuries: scale exposure down when realised vol /
 * regime stress widens, expand it when the regime is calm and constructive.
 */
export type Regime =
  | "drawdown_breach" // drawdown ≥ 1.5%
  | "crash"           // 24h ≤ -3%
  | "down_wide"       // 24h ≤ -1% AND spread ≥ 1%
  | "down_tight"      // 24h ≤ -1% AND spread < 1%
  | "flat"            // -1% < 24h < +1%
  | "up_wide"         // 24h ≥ +1% AND spread ≥ 1%
  | "up_tight";       // 24h ≥ +1% AND spread < 1%

function classifyRegime(input: {
  drawdownPct: number;
  change24h: number;
  spreadPct: number;
}): Regime {
  if (input.drawdownPct >= DRAWDOWN_BREACH_PCT) return "drawdown_breach";
  if (input.change24h <= -3) return "crash";
  if (input.change24h <= -1) return input.spreadPct >= 1 ? "down_wide" : "down_tight";
  if (input.change24h < 1) return "flat";
  return input.spreadPct >= 1 ? "up_wide" : "up_tight";
}

/**
 * Target risk-asset share (% of TVL) for a given regime + preset tier.
 *
 * Aggressive presets (maxAllocationBps ≥ 5000) get a slightly higher
 * constructive target so the tier's larger envelope translates into a
 * visibly different position than Balanced under the same conditions.
 */
function targetShareForRegime(regime: Regime, maxAllocationBps: number): number {
  const isAggressive = maxAllocationBps >= 5000;
  let rawTarget: number;
  switch (regime) {
    case "drawdown_breach":
    case "crash":
      rawTarget = 0;
      break;
    case "down_wide":
      rawTarget = 10;
      break;
    case "down_tight":
      rawTarget = 18;
      break;
    case "flat":
      rawTarget = 22;
      break;
    case "up_wide":
      rawTarget = 20;
      break;
    case "up_tight":
      rawTarget = isAggressive ? 28 : 25;
      break;
  }
  return Math.min(rawTarget, maxAllocationBps / 100);
}

interface StrategyRecommendation {
  regime: Regime;
  targetShare: number;
  recommendedAction: "Rebalance" | "EmergencyDeleverage" | "hold";
  recommendedAmountBps: number;
  rationale: string;
}

/**
 * Compute the deterministic strategy recommendation. Hold band is ±3pp from
 * target (anti-flap). Outside the band the recommendation translates the gap
 * into a concrete amount_bps using actual balances + price + TVL — so the
 * LLM never has to do float math, and the recommendation is reproducible
 * off-chain by anyone with the same inputs.
 */
export function computeStrategy(input: {
  currentShare: number;
  drawdownPct: number;
  change24h: number;
  spreadPct: number;
  baseBalance: number;
  riskBalance: number;
  tvl: number;
  priceUsd: number;
  maxAllocationBps: number;
  rebalanceThresholdBps: number;
}): StrategyRecommendation {
  const regime = classifyRegime({
    drawdownPct: input.drawdownPct,
    change24h: input.change24h,
    spreadPct: input.spreadPct,
  });
  const targetShare = targetShareForRegime(regime, input.maxAllocationBps);
  const drift = input.currentShare - targetShare;
  const holdBandPct = Math.max(3, input.rebalanceThresholdBps / 100);

  // Hard regime: drawdown breach or 24h crash → full deleverage.
  if (regime === "drawdown_breach" || regime === "crash") {
    if (input.riskBalance <= 0) {
      return { regime, targetShare, recommendedAction: "hold", recommendedAmountBps: 0,
        rationale: `${regime} but no risk balance to deleverage` };
    }
    return {
      regime,
      targetShare,
      recommendedAction: "EmergencyDeleverage",
      recommendedAmountBps: 9500,
      rationale: `${regime}: deleverage 95% of risk balance to base stable`,
    };
  }

  if (Math.abs(drift) < holdBandPct) {
    return {
      regime,
      targetShare,
      recommendedAction: "hold",
      recommendedAmountBps: 0,
      rationale: `regime=${regime}, share=${input.currentShare.toFixed(1)}% ≈ target=${targetShare}% (drift ${drift.toFixed(1)}pp within ${holdBandPct.toFixed(1)}pp hold band)`,
    };
  }

  // Drift < -3pp → deploy base into risk to reach target.
  if (drift < -3) {
    if (input.baseBalance <= 0) {
      return { regime, targetShare, recommendedAction: "hold", recommendedAmountBps: 0,
        rationale: `regime=${regime}, under-target but no base balance` };
    }
    const deployValueUsd = (Math.abs(drift) / 100) * input.tvl;
    const ratio = Math.min(1, deployValueUsd / input.baseBalance);
    const bps = Math.min(Math.round(ratio * 10000), input.maxAllocationBps);
    return {
      regime,
      targetShare,
      recommendedAction: "Rebalance",
      recommendedAmountBps: bps,
      rationale: `regime=${regime}, deploy ${deployValueUsd.toFixed(2)} base toward ${targetShare}% target`,
    };
  }

  // Drift > +3pp → trim risk back toward target.
  const riskValueUsd = input.riskBalance * input.priceUsd;
  if (riskValueUsd <= 0) {
    return { regime, targetShare, recommendedAction: "hold", recommendedAmountBps: 0,
      rationale: `regime=${regime}, over-target but no risk balance` };
  }
  const trimValueUsd = (drift / 100) * input.tvl;
  const ratio = Math.min(1, trimValueUsd / riskValueUsd);
  const bps = Math.min(Math.round(ratio * 10000), 9500);
  return {
    regime,
    targetShare,
    recommendedAction: "EmergencyDeleverage",
    recommendedAmountBps: bps,
    rationale: `regime=${regime}, trim ${trimValueUsd.toFixed(2)} of risk toward ${targetShare}% target`,
  };
}

// ── Anti-churn guard ────────────────────────────────────────────────────────
//
// The regime classifier maps live signals to discrete targets whose steps
// (e.g. flat 22% → up_tight 25%) exceed the ±3pp hold band. Near a regime
// boundary this can produce buy → sell → buy churn — each leg individually
// policy-compliant, but together pure noise: gas + Sealed Inference compute
// spent to nudge a few percent of allocation. The guard below damps that
// WITHOUT touching any on-chain policy threshold or the regime classifier.

/**
 * Per-vault count of how many consecutive cycles the current regime has held.
 * Process-local (lost on restart, which only re-warms the count over a couple
 * of cycles — safety regimes bypass the guard anyway, so funds are never at
 * risk from a cold start).
 */
const regimeObservationHistory = new Map<string, { regime: Regime; observations: number }>();

/**
 * Record this cycle's regime for a vault and return how many consecutive
 * cycles it has now held (≥ 1). A regime change resets the count to 1.
 */
export function recordRegimeObservation(vaultAddress: string, regime: Regime): number {
  const key = vaultAddress.toLowerCase();
  const prev = regimeObservationHistory.get(key);
  if (prev && prev.regime === regime) {
    prev.observations += 1;
    return prev.observations;
  }
  regimeObservationHistory.set(key, { regime, observations: 1 });
  return 1;
}

export interface AntiChurnInput {
  recommendedAction: "Rebalance" | "EmergencyDeleverage" | "hold";
  /** Intended trade value in USD. */
  tradeValueUsd: number;
  regime: Regime;
  /** Absolute drift from the regime target, in percentage points. */
  driftPp: number;
  /** Enum of the last on-chain execution (0 Rebalance, 1 YieldFarm, 2 EmergencyDeleverage), or null if none. */
  lastExecutedAction: number | null;
  /** Seconds since the last execution, or null if the vault has never executed. */
  secondsSinceLastExecution: number | null;
  /** Consecutive cycles the current regime has held (≥ 1). */
  regimeObservations: number;
}

export interface AntiChurnVerdict {
  block: boolean;
  reason?: string;
}

/**
 * Deterministic anti-churn evaluation. Pure — no I/O, reproducible off-chain.
 *
 * Two checks, both bypassed by safety regimes (drawdown_breach, crash) so
 * defensive deleveraging is never delayed:
 *   (A) minimum economic trade size — skip sub-MIN_TRADE_NOTIONAL_USD trades;
 *   (B) reversal damping — block a trade that reverses the direction of a
 *       recent execution unless the drift is large or the regime has been
 *       confirmed over ANTICHURN_REGIME_CONFIRM_CYCLES cycles.
 */
export function evaluateAntiChurn(input: AntiChurnInput): AntiChurnVerdict {
  const isSafetyRegime = input.regime === "drawdown_breach" || input.regime === "crash";
  if (isSafetyRegime) return { block: false };

  // (A) Minimum economic trade size.
  if (input.tradeValueUsd < MIN_TRADE_NOTIONAL_USD) {
    return {
      block: true,
      reason:
        `trade value $${input.tradeValueUsd.toFixed(4)} below minimum economic size ` +
        `($${MIN_TRADE_NOTIONAL_USD}) — skipped to avoid gas/compute churn`,
    };
  }

  // (B) Reversal damping — only when a recent execution exists to reverse.
  if (
    input.lastExecutedAction !== null &&
    input.secondsSinceLastExecution !== null &&
    input.secondsSinceLastExecution < ANTICHURN_WINDOW_SEC
  ) {
    const lastWasBuy = input.lastExecutedAction === 0; // Rebalance
    const lastWasSell = input.lastExecutedAction === 2; // EmergencyDeleverage
    const nextIsBuy = input.recommendedAction === "Rebalance";
    const nextIsSell = input.recommendedAction === "EmergencyDeleverage";
    const reverses = (lastWasBuy && nextIsSell) || (lastWasSell && nextIsBuy);
    if (reverses) {
      const largeDrift = input.driftPp >= ANTICHURN_OVERRIDE_DRIFT_PP;
      const regimeConfirmed = input.regimeObservations >= ANTICHURN_REGIME_CONFIRM_CYCLES;
      if (!largeDrift && !regimeConfirmed) {
        return {
          block: true,
          reason:
            `anti-churn hold — a small ${input.recommendedAction} would reverse the ` +
            `previous trade; regime not yet confirmed and drift ${input.driftPp.toFixed(1)}pp ` +
            `below the ${ANTICHURN_OVERRIDE_DRIFT_PP}pp override`,
        };
      }
    }
  }

  return { block: false };
}

/**
 * Defensive contract for the LLM's role in the loop. The deterministic
 * recommendation defines the *most aggressive* permissible action for the
 * current regime; the LLM may only confirm it or pick a strictly more
 * cautious action. Specifically:
 *
 *   1. In `crash` or `drawdown_breach` regimes, no Rebalance buy is allowed.
 *   2. If the recommendation is a Rebalance buy with N bps, the LLM may
 *      return a buy in [0, N] or fall back to hold (amount_bps = 0).
 *   3. If the recommendation is an EmergencyDeleverage of N bps, the LLM
 *      must return EmergencyDeleverage with amount_bps in [N, 9500] —
 *      under-trimming a defensive recommendation is forbidden.
 *   4. The LLM may always pick "hold" (action=Rebalance, amount_bps=0).
 *
 * Any other override is treated as a contract violation: the cycle is
 * skipped and the reason is logged. This makes the "AI as defensive
 * verifier" claim machine-checked in the call path, not only in the
 * prompt doctrine.
 */
export function validateAgainstRecommendation(
  decision: AgentDecision,
  recommendation: StrategyRecommendation,
): { ok: true } | { ok: false; reason: string } {
  // Hold is always allowed regardless of recommendation.
  const isHold = decision.action === "Rebalance" && decision.amount_bps === 0;
  if (isHold) return { ok: true };

  // Crash / drawdown_breach regimes never permit a risk-on buy.
  if (
    (recommendation.regime === "crash" || recommendation.regime === "drawdown_breach") &&
    decision.action === "Rebalance" &&
    decision.amount_bps > 0
  ) {
    return {
      ok: false,
      reason: `regime=${recommendation.regime} forbids any Rebalance buy; LLM proposed ${decision.amount_bps}bps`,
    };
  }

  if (recommendation.recommendedAction === "Rebalance") {
    // Recommendation is a buy. LLM may scale it down or hold; never up.
    if (decision.action !== "Rebalance") {
      return {
        ok: false,
        reason: `model disagreement: deterministic policy recommended Rebalance(${recommendation.recommendedAmountBps}bps); model picked ${decision.action}; skipped with no trade sent`,
      };
    }
    if (decision.amount_bps > recommendation.recommendedAmountBps) {
      return {
        ok: false,
        reason: `LLM amount_bps=${decision.amount_bps} exceeds recommended Rebalance buy of ${recommendation.recommendedAmountBps}bps (override toward more aggressive forbidden)`,
      };
    }
    return { ok: true };
  }

  if (recommendation.recommendedAction === "EmergencyDeleverage") {
    // Recommendation is a defensive trim/deleverage. LLM may go further or hold.
    // (Hold is already allowed at the top of the function.)
    if (decision.action !== "EmergencyDeleverage") {
      return {
        ok: false,
        reason: `recommended EmergencyDeleverage(${recommendation.recommendedAmountBps}bps); LLM picked ${decision.action} which is less defensive`,
      };
    }
    if (decision.amount_bps < recommendation.recommendedAmountBps) {
      return {
        ok: false,
        reason: `LLM amount_bps=${decision.amount_bps} below recommended EmergencyDeleverage of ${recommendation.recommendedAmountBps}bps (under-trim of defensive recommendation forbidden)`,
      };
    }
    return { ok: true };
  }

  // Recommendation was "hold". The LLM must also hold (already covered above).
  return {
    ok: false,
    reason: `recommendation was hold; LLM proposed ${decision.action} ${decision.amount_bps}bps`,
  };
}

function buildMarketPrompt(input: {
  baseBalance: string;
  riskBalance: string;
  tvl: string;
  hwm: string;
  market: { priceUsd: number; riskSymbol: string; baseSymbol: string; change24h: number; source: string; spreadPct: number };
  policy: {
    maxAllocationBps: number;
    maxDrawdownBps: number;
    rebalanceThresholdBps: number;
    maxSlippageBps: number;
    cooldownPeriod: number;
  };
}): { prompt: string; recommendation: StrategyRecommendation } {
  const baseN = Number(input.baseBalance);
  const riskN = Number(input.riskBalance);
  const tvlN = Number(input.tvl);
  const hwmN = Number(input.hwm);
  const riskSymbol = input.market.riskSymbol ?? "ETH";
  const baseSymbol = input.market.baseSymbol ?? "USDC";
  const riskValueUsd = riskN * input.market.priceUsd;
  const riskSharePct = tvlN > 0 ? (riskValueUsd / tvlN) * 100 : 0;
  const drawdownPct = hwmN > 0 ? ((hwmN - tvlN) / hwmN) * 100 : 0;
  const spreadPct = input.market.spreadPct ?? 0;

  // Deterministic vol-adjusted regime-aware recommendation. Computed in TS so
  // the LLM never has to do float math; LLM's job is to confirm or override.
  const recommendation = computeStrategy({
    currentShare: riskSharePct,
    drawdownPct,
    change24h: input.market.change24h,
    spreadPct,
    baseBalance: baseN,
    riskBalance: riskN,
    tvl: tvlN,
    priceUsd: input.market.priceUsd,
    maxAllocationBps: input.policy.maxAllocationBps,
    rebalanceThresholdBps: input.policy.rebalanceThresholdBps,
  });

  const prompt = `Treasury state (computed):
- ${baseSymbol} balance: ${baseN.toFixed(2)} ${baseSymbol}
- ${riskSymbol} balance: ${riskN.toFixed(6)} ${riskSymbol}
- ${riskSymbol} value at market: ${riskValueUsd.toFixed(2)} ${baseSymbol}
- TVL: ${tvlN.toFixed(2)} ${baseSymbol}
- HWM: ${hwmN.toFixed(2)} ${baseSymbol}
- Drawdown from HWM: ${drawdownPct.toFixed(2)}%
- ${riskSymbol} share of TVL: ${riskSharePct.toFixed(2)}%

Market (${input.market.source}):
- ${riskSymbol}/USD: $${input.market.priceUsd.toFixed(4)}
- 24h change: ${input.market.change24h.toFixed(2)}%
- Oracle spread (Pyth vs Jaine): ${spreadPct.toFixed(3)}%

Policy bounds:
- Max post-trade ${riskSymbol} exposure: ${input.policy.maxAllocationBps / 100}% of TVL
- Max drawdown from HWM: ${input.policy.maxDrawdownBps / 100}%
- Rebalance hold band: ${input.policy.rebalanceThresholdBps / 100}pp around target
- Max slippage: ${input.policy.maxSlippageBps / 100}%
- Cooldown between actions: ${input.policy.cooldownPeriod}s

Strategy v2 recommendation (vol-adjusted regime-aware):
- Regime: ${recommendation.regime}
- Target share: ${recommendation.targetShare}% of TVL
- Recommended action: ${recommendation.recommendedAction}
- Recommended amount_bps: ${recommendation.recommendedAmountBps}
- Rationale: ${recommendation.rationale}

Confirm the recommendation by returning the same action and amount_bps, OR
override only if a critical reason justifies it (state your reason in
short_reason). Respond with the JSON object only.`;

  return { prompt, recommendation };
}
