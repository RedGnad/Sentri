import { ethers } from "ethers";
import "dotenv/config";
import {
  CHAIN,
  CONTRACTS,
  TREASURY_VAULT_ABI,
  PRICE_FEED_ABI,
  ERC20_ABI,
  VAULT_FACTORY_ABI,
  AGENT,
} from "./constants.js";
import {
  initInference,
  selectProvider,
  acknowledgeProvider,
  requestInference,
  TREASURY_SYSTEM_PROMPT,
} from "./inference.js";
import { initStorage, appendAuditLog, savePortfolioState } from "./storage.js";
import { getMarketSnapshot, type MarketSnapshot } from "./market.js";

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
export interface GlobalContext {
  wallet: ethers.Wallet;
  provider: ethers.JsonRpcProvider;
  factory: ethers.Contract;
  priceFeed: ethers.Contract;
  walletAddress: string;
  providerInfo: { address: string; model: string; endpoint: string; verifiability: string; teeSignerAddress: string };
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

  log("Initializing 0G Sealed Inference broker...");
  await initInference(privateKey);

  log("Selecting inference provider...");
  const providerInfo = await selectProvider();
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

  return { wallet, provider, factory, priceFeed, walletAddress: wallet.address, providerInfo };
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

  const isKilled: boolean = await vault.killed();
  if (isKilled) {
    return { status: "killed", reason: "vault is killed" };
  }
  const isPaused: boolean = await vault.paused();
  if (isPaused) {
    return { status: "skipped", reason: "vault is paused" };
  }

  // Read full vault state
  const [baseAddr, riskAddr, baseBalance, riskBalance, tvl, hwm, policy, logCount] = await Promise.all([
    vault.base(),
    vault.risk(),
    vault.vaultBalance(),
    vault.riskBalance(),
    vault.totalValue(),
    vault.highWaterMark(),
    vault.policy(),
    vault.executionLogCount(),
  ]);

  const baseToken = new ethers.Contract(baseAddr, ERC20_ABI, ctx.wallet);
  const riskToken = new ethers.Contract(riskAddr, ERC20_ABI, ctx.wallet);
  const [baseDec, riskDec] = await Promise.all([baseToken.decimals(), riskToken.decimals()]);

  const baseStr = ethers.formatUnits(baseBalance, baseDec);
  const riskStr = ethers.formatUnits(riskBalance, riskDec);
  const tvlStr = ethers.formatUnits(tvl, baseDec);
  const hwmStr = ethers.formatUnits(hwm, baseDec);
  const baseSymbol = market.baseSymbol ?? "USDC";
  const riskSymbol = market.riskSymbol ?? "ETH";

  log(
    `Vault ${vaultAddress.slice(0, 10)}...: ${baseStr} ${baseSymbol} + ${riskStr} ${riskSymbol} | ` +
      `TVL ${tvlStr} | HWM ${hwmStr} | logs ${logCount}`,
  );

  if (tvl === 0n) {
    return { status: "skipped", reason: "vault is empty" };
  }

  if (market.tradingAllowed === false) {
    return {
      status: "skipped",
      reason:
        `market health ${market.health}; ${riskSymbol} trading requires Jaine on-chain price plus external sanity check. ` +
        `Sources: ${market.source}. Failures: ${market.failures.join(" | ") || "none"}`,
    };
  }

  const prompt = buildMarketPrompt({
    baseBalance: baseStr,
    riskBalance: riskStr,
    tvl: tvlStr,
    hwm: hwmStr,
    market,
    policy: {
      maxAllocationBps: Number(policy[0]),
      maxDrawdownBps: Number(policy[1]),
      rebalanceThresholdBps: Number(policy[2]),
      maxSlippageBps: Number(policy[3]),
      cooldownPeriod: Number(policy[4]),
    },
  });

  log("Requesting Sealed Inference (TEE)...");
  const inference = await requestInference(prompt, TREASURY_SYSTEM_PROMPT);
  log(
    `TEE verified: ${inference.verified} | ChatID: ${inference.chatID} | ` +
      `Signer: ${inference.teeSignerAddress}`,
  );

  let decision: AgentDecision;
  try {
    decision = parseAgentDecision(inference.modelResponse);
  } catch {
    return { status: "skipped", reason: `invalid JSON from LLM: ${inference.modelResponse.slice(0, 120)}` };
  }
  const validationError = validateDecision(decision);
  if (validationError) return { status: "skipped", reason: validationError };
  const reasoning = decision.short_reason ?? decision.reasoning ?? "";
  log(`Decision: ${decision.action} | ${decision.amount_bps}bps | conf ${decision.confidence}%`);
  log(`Reasoning: ${reasoning}`);

  if (decision.amount_bps === 0) {
    return { status: "skipped", reason: "no action needed (amount_bps=0)" };
  }

  // Size the order
  let amountIn: bigint;
  if (decision.action === "EmergencyDeleverage") {
    amountIn = (BigInt(riskBalance) * BigInt(decision.amount_bps)) / 10000n;
    if (amountIn === 0n) return { status: "skipped", reason: "no risk balance to deleverage" };
  } else {
    amountIn = (BigInt(baseBalance) * BigInt(decision.amount_bps)) / 10000n;
    if (amountIn === 0n) return { status: "skipped", reason: "no base balance to allocate" };
    const currentRiskValue = Number(riskStr) * market.priceUsd;
    const maxRiskValue = Number(tvlStr) * Number(policy[0]) / 10000;
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

  const policySnapshot = {
    maxAllocationBps: Number(policy[0]),
    maxDrawdownBps: Number(policy[1]),
    rebalanceThresholdBps: Number(policy[2]),
    maxSlippageBps: Number(policy[3]),
    cooldownPeriod: Number(policy[4]),
    maxPriceStaleness: Number(policy[5]),
  };
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
    price: market.priceUsd,
    priceSource: market.source,
    policySnapshot,
    deadline,
  };
  const intentHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalJson(intent)));
  const priceAttestationPayload = {
    medianPrice: market.priceUsd,
    sourceCount: market.sourceCount,
    spreadPct: market.spreadPct,
    sources: market.rawSources,
    timestamp: market.timestamp,
  };

  // Execute
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
    const receipt = await tx.wait();

    // Use chain block timestamp × 1000 for the audit cache key so the dashboard
    // (which reads executionLogs[].timestamp from chain and queries by × 1000)
    // gets a deterministic match.
    const execBlock = await receipt.getBlock();
    const chainTimestampMs = Number(execBlock.timestamp) * 1000;

    // Determine actual amounts from the latest log
    const idx = (await vault.executionLogCount()) - 1n;
    const latestLog = await vault.executionLogs(idx);
    const amountOut = latestLog[3];

    const formattedAmountIn =
      decision.action === "EmergencyDeleverage"
        ? ethers.formatUnits(amountIn, riskDec)
        : ethers.formatUnits(amountIn, baseDec);
    const formattedAmountOut =
      decision.action === "EmergencyDeleverage"
        ? ethers.formatUnits(amountOut, baseDec)
        : ethers.formatUnits(amountOut, riskDec);

    log(`TX confirmed: ${receipt.hash}. Saving audit + state to 0G Storage...`);

    await appendAuditLog(vaultAddress, {
      timestamp: chainTimestampMs,
      logIndex: Number(idx),
      action: decision.action,
      amount: formattedAmountIn,
      intent,
      intentHash,
      responseHash: inference.responseHash,
      modelResponse: inference.modelResponse,
      signedResponse: inference.signedResponse,
      teeSignature: inference.teeSignature,
      teeSigner: inference.teeSignerAddress,
      teeAttestation: inference.teeAttestation,
      deadline,
      verified: inference.verified,
      provider: inference.provider,
      model: inference.model,
      verifiability: inference.verifiability,
      chatID: inference.chatID,
      reasoning,
      confidence: decision.confidence,
      txHash: receipt.hash,
      marketPrice: market.priceUsd,
      marketSource: market.source,
      marketSpreadPct: market.spreadPct,
      marketSourceCount: market.sourceCount,
      marketRawSources: market.rawSources,
      priceAttestationPayload,
    });

    // Refresh and persist portfolio state
    const [newBase, newRisk, newTvl, newHwm, newLogCount] = await Promise.all([
      vault.vaultBalance(),
      vault.riskBalance(),
      vault.totalValue(),
      vault.highWaterMark(),
      vault.executionLogCount(),
    ]);

    await savePortfolioState(vaultAddress, {
      vaultBalance: ethers.formatUnits(newBase, baseDec),
      riskBalance: ethers.formatUnits(newRisk, riskDec),
      totalValue: ethers.formatUnits(newTvl, baseDec),
      highWaterMark: ethers.formatUnits(newHwm, baseDec),
      lastAction: decision.action,
      lastActionTime: Date.now(),
      totalExecutions: Number(newLogCount),
      pnlBps: newHwm > 0n ? Number(((BigInt(newTvl) - BigInt(newHwm)) * 10000n) / BigInt(newHwm)) : 0,
      marketPrice: market.priceUsd,
    });

    return {
      status: "executed",
      action: decision.action,
      amountIn: formattedAmountIn,
      amountOut: formattedAmountOut,
      txHash: receipt.hash,
      reasoning,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const COOLDOWN = "0xa22b745e";
    const ALLOCATION = "0xc630a00d";
    const DRAWDOWN = "0x4f3a5fbf";
    const STALE = "PriceStale";
    if (msg.includes("CooldownNotElapsed") || msg.includes(COOLDOWN)) {
      return { status: "skipped", reason: "cooldown not elapsed" };
    } else if (msg.includes("AllocationExceeded") || msg.includes(ALLOCATION)) {
      return { status: "skipped", reason: "allocation exceeded" };
    } else if (msg.includes("DrawdownBreached") || msg.includes(DRAWDOWN)) {
      return { status: "skipped", reason: "drawdown breached" };
    } else if (msg.includes(STALE)) {
      return { status: "skipped", reason: "oracle price stale" };
    } else if (msg.includes("InsufficientAmountOut")) {
      return { status: "skipped", reason: "swap reverted on slippage guard" };
    } else if (msg.includes("VaultKilled")) {
      return { status: "killed", reason: "vault killed mid-iteration" };
    }
    throw err; // re-throw unknown errors so the server logs them
  }
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
      const market = await pushPrice(ctx);
      const vaults = await discoverVaults(ctx);
      log(`Cycle: ${vaults.length} vault(s) tracked`);

      for (const vaultAddr of vaults) {
        try {
          const outcome = await executeOneIterationForVault(ctx, vaultAddr, market);
          log(`  ${vaultAddr.slice(0, 10)}... → ${outcome.status}${
            outcome.status === "executed" ? ` (${outcome.action})` : `: ${outcome.reason ?? ""}`
          }`);
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
type Regime =
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
  if (input.drawdownPct >= 1.5) return "drawdown_breach";
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
  switch (regime) {
    case "drawdown_breach":
    case "crash":
      return 0;
    case "down_wide":
      return 10;
    case "down_tight":
      return 18;
    case "flat":
      return 22;
    case "up_wide":
      return 20;
    case "up_tight":
      return isAggressive ? 28 : 25;
  }
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
function computeStrategy(input: {
  currentShare: number;
  drawdownPct: number;
  change24h: number;
  spreadPct: number;
  baseBalance: number;
  riskBalance: number;
  tvl: number;
  priceUsd: number;
  maxAllocationBps: number;
}): StrategyRecommendation {
  const regime = classifyRegime({
    drawdownPct: input.drawdownPct,
    change24h: input.change24h,
    spreadPct: input.spreadPct,
  });
  const targetShare = targetShareForRegime(regime, input.maxAllocationBps);
  const drift = input.currentShare - targetShare;

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

  // Within ±3pp of target → hold (anti-flap band).
  if (Math.abs(drift) < 3) {
    return {
      regime,
      targetShare,
      recommendedAction: "hold",
      recommendedAmountBps: 0,
      rationale: `regime=${regime}, share=${input.currentShare.toFixed(1)}% ≈ target=${targetShare}% (drift ${drift.toFixed(1)}pp)`,
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
}): string {
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
  });

  return `Treasury state (computed):
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
}
