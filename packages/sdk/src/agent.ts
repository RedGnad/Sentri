import { ethers } from "ethers";
import "dotenv/config";
import {
  CHAIN,
  CONTRACTS,
  TREASURY_VAULT_ABI,
  PRICE_FEED_ABI,
  ERC20_ABI,
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
import { getMarketSnapshot } from "./market.js";

// ── Types ─────────────────────────────────────────────────────────────────

interface AgentDecision {
  action: "Rebalance" | "YieldFarm" | "EmergencyDeleverage";
  amount_bps: number;
  reasoning: string;
  confidence: number;
}

const ACTION_MAP: Record<string, number> = {
  Rebalance: 0,
  YieldFarm: 1,
  EmergencyDeleverage: 2,
};

export interface AgentContext {
  vault: ethers.Contract;
  usdc: ethers.Contract;
  priceFeed: ethers.Contract;
  walletAddress: string;
  providerInfo: { address: string; model: string; endpoint: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function getEnvOrThrow(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

// ── Setup (run once) ──────────────────────────────────────────────────────

export async function setupAgent(): Promise<AgentContext> {
  const privateKey = getEnvOrThrow("PRIVATE_KEY");
  const vaultAddress = CONTRACTS.treasuryVault || getEnvOrThrow("NEXT_PUBLIC_TREASURY_VAULT_ADDRESS");
  const usdcAddress = CONTRACTS.mockUSDC || getEnvOrThrow("NEXT_PUBLIC_MOCK_USDC_ADDRESS");
  const priceFeedAddress = CONTRACTS.priceFeed || getEnvOrThrow("NEXT_PUBLIC_PRICE_FEED_ADDRESS");

  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const vault = new ethers.Contract(vaultAddress, TREASURY_VAULT_ABI, wallet);
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, wallet);
  const priceFeed = new ethers.Contract(priceFeedAddress, PRICE_FEED_ABI, wallet);

  log("Initializing 0G Sealed Inference broker...");
  await initInference(privateKey);

  log("Selecting inference provider...");
  const providerInfo = await selectProvider();
  log(`Provider: ${providerInfo.address} | Model: ${providerInfo.model}`);

  log("Acknowledging provider TEE signer...");
  await acknowledgeProvider();

  log("Initializing 0G Storage...");
  initStorage(privateKey);

  log(`Agent ready. Wallet: ${wallet.address}`);

  return { vault, usdc, priceFeed, walletAddress: wallet.address, providerInfo };
}

// ── One iteration of the agent loop ───────────────────────────────────────

export async function executeOneIteration(ctx: AgentContext): Promise<void> {
  const { vault, priceFeed } = ctx;

  const isKilled = await vault.killed();
  if (isKilled) {
    log("Vault is KILLED. Agent cannot operate.");
    throw new Error("VAULT_KILLED");
  }

  const isPaused = await vault.paused();
  if (isPaused) {
    log("Vault is PAUSED. Skipping iteration.");
    return;
  }

  // 1. Fetch real market price
  const market = await getMarketSnapshot();
  log(`Market: ETH=$${market.ethUsd.toFixed(2)} (${market.change24h.toFixed(2)}% 24h, ${market.source})`);

  // 2. Push price on-chain so the vault's slippage check uses fresh data.
  const feedDecimals: bigint = await priceFeed.decimals();
  const answer = BigInt(Math.floor(market.ethUsd * 10 ** Number(feedDecimals)));
  const priceAttestation = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify({ source: market.source, price: market.ethUsd, ts: market.timestamp })),
  );

  try {
    const pushTx = await priceFeed.pushAnswer(answer, priceAttestation);
    await pushTx.wait();
    log(`Price pushed on-chain: answer=${answer} (attestation=${priceAttestation.slice(0, 10)}...)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("NotKeeper") || msg.includes("0xf7f0e693")) {
      log("Agent is not a registered keeper on SentriPriceFeed. Skipping iteration.");
      return;
    }
    throw err;
  }

  // 3. Fetch full vault state
  const [baseBalance, riskBalance, tvl, hwm, policy, logCount] = await Promise.all([
    vault.vaultBalance(),
    vault.riskBalance(),
    vault.totalValue(),
    vault.highWaterMark(),
    vault.policy(),
    vault.executionLogCount(),
  ]);

  const baseStr = ethers.formatUnits(baseBalance, 6);
  const riskStr = ethers.formatUnits(riskBalance, 18);
  const tvlStr = ethers.formatUnits(tvl, 6);
  const hwmStr = ethers.formatUnits(hwm, 6);

  log(`Vault: ${baseStr} USDC + ${riskStr} WETH | TVL: ${tvlStr} | HWM: ${hwmStr} | Executions: ${logCount}`);

  if (tvl === 0n) {
    log("Vault is empty. Skipping iteration.");
    return;
  }

  // 4. Build prompt
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

  // 5. Sealed Inference (TEE)
  log("Requesting Sealed Inference analysis (TEE)...");
  const inference = await requestInference(prompt, TREASURY_SYSTEM_PROMPT);
  log(`TEE verified: ${inference.verified} | ChatID: ${inference.chatID}`);

  let decision: AgentDecision;
  try {
    decision = JSON.parse(inference.content) as AgentDecision;
  } catch {
    log(`Failed to parse LLM response: ${inference.content.slice(0, 200)}`);
    return;
  }

  log(`Decision: ${decision.action} | Amount: ${decision.amount_bps} bps | Confidence: ${decision.confidence}%`);
  log(`Reasoning: ${decision.reasoning}`);

  if (decision.amount_bps === 0) {
    log("No action needed. Skipping execution.");
    return;
  }

  // 6. Size the order
  let amountIn: bigint;
  if (decision.action === "EmergencyDeleverage") {
    amountIn = (BigInt(riskBalance) * BigInt(decision.amount_bps)) / 10000n;
    if (amountIn === 0n) {
      log("No risk position to deleverage. Skipping.");
      return;
    }
    log(`Deleveraging ${ethers.formatUnits(amountIn, 18)} WETH`);
  } else {
    amountIn = (BigInt(baseBalance) * BigInt(decision.amount_bps)) / 10000n;
    if (amountIn === 0n) {
      log("No base balance to allocate. Skipping.");
      return;
    }
    const maxAlloc = (BigInt(tvl) * BigInt(policy[0])) / 10000n;
    if (amountIn > maxAlloc) {
      log(`Capping amount from ${ethers.formatUnits(amountIn, 6)} to ${ethers.formatUnits(maxAlloc, 6)} USDC (max allocation)`);
      amountIn = maxAlloc;
    }
    log(`Allocating ${ethers.formatUnits(amountIn, 6)} USDC to risk asset`);
  }

  // 7. Execute on-chain
  try {
    const tx = await vault.executeStrategy(
      ACTION_MAP[decision.action],
      amountIn,
      inference.proofHash,
      inference.teeAttestation,
    );
    const receipt = await tx.wait();
    log(`TX confirmed: ${receipt.hash}`);

    // 8. Audit log to 0G Storage
    log("Saving audit entry to 0G Storage...");
    await appendAuditLog({
      timestamp: Date.now(),
      action: decision.action,
      amount:
        decision.action === "EmergencyDeleverage"
          ? ethers.formatUnits(amountIn, 18)
          : ethers.formatUnits(amountIn, 6),
      proofHash: inference.proofHash,
      teeAttestation: inference.teeAttestation,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      txHash: receipt.hash,
      marketPrice: market.ethUsd,
      marketSource: market.source,
    });

    // 9. Persist portfolio state
    const [newBase, newRisk, newTvl, newHwm, newLogCount] = await Promise.all([
      vault.vaultBalance(),
      vault.riskBalance(),
      vault.totalValue(),
      vault.highWaterMark(),
      vault.executionLogCount(),
    ]);

    await savePortfolioState({
      vaultBalance: ethers.formatUnits(newBase, 6),
      riskBalance: ethers.formatUnits(newRisk, 18),
      totalValue: ethers.formatUnits(newTvl, 6),
      highWaterMark: ethers.formatUnits(newHwm, 6),
      lastAction: decision.action,
      lastActionTime: Date.now(),
      totalExecutions: Number(newLogCount),
      pnlBps: newHwm > 0n ? Number(((BigInt(newTvl) - BigInt(newHwm)) * 10000n) / BigInt(newHwm)) : 0,
      marketPrice: market.ethUsd,
    });

    log("Iteration complete.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const COOLDOWN = "0xa22b745e";
    const ALLOCATION = "0xc630a00d";
    const DRAWDOWN = "0x4f3a5fbf";
    const STALE = "PriceStale";
    if (msg.includes("CooldownNotElapsed") || msg.includes(COOLDOWN)) {
      log("Cooldown not elapsed. Skipping execution.");
    } else if (msg.includes("AllocationExceeded") || msg.includes(ALLOCATION)) {
      log("Allocation exceeded policy. Skipping.");
    } else if (msg.includes("DrawdownBreached") || msg.includes(DRAWDOWN)) {
      log("Drawdown breached policy. Skipping.");
    } else if (msg.includes(STALE)) {
      log("Oracle reported stale price. Skipping.");
    } else if (msg.includes("InsufficientAmountOut")) {
      log("Swap reverted on slippage guard. Skipping.");
    } else {
      throw err;
    }
  }
}

// ── Standalone loop (for `pnpm agent` CLI) ────────────────────────────────

export async function runStandaloneLoop(): Promise<void> {
  const ctx = await setupAgent();
  log("Starting loop.\n");

  while (true) {
    try {
      await executeOneIteration(ctx);
    } catch (err) {
      log(`ERROR in agent iteration: ${err instanceof Error ? err.message : err}`);
    }

    log(`Sleeping ${AGENT.loopIntervalMs / 1000}s until next iteration...\n`);
    await new Promise((r) => setTimeout(r, AGENT.loopIntervalMs));
  }
}

function buildMarketPrompt(input: {
  baseBalance: string;
  riskBalance: string;
  tvl: string;
  hwm: string;
  market: { ethUsd: number; change24h: number; source: string };
  policy: {
    maxAllocationBps: number;
    maxDrawdownBps: number;
    rebalanceThresholdBps: number;
    maxSlippageBps: number;
    cooldownPeriod: number;
  };
}): string {
  const pnl =
    Number(input.hwm) > 0
      ? (((Number(input.tvl) - Number(input.hwm)) / Number(input.hwm)) * 100).toFixed(2)
      : "0";
  return `Current Treasury State:
- Base (USDC) balance: ${input.baseBalance}
- Risk (WETH) balance: ${input.riskBalance}
- Total Value (base units): ${input.tvl}
- High Water Mark: ${input.hwm}
- P&L from HWM: ${pnl}%

Risk Policy:
- Max Allocation per Action: ${input.policy.maxAllocationBps / 100}% of TVL
- Max Drawdown from HWM: ${input.policy.maxDrawdownBps / 100}%
- Max Slippage: ${input.policy.maxSlippageBps / 100}%
- Cooldown: ${input.policy.cooldownPeriod}s

Live Market (${input.market.source}):
- ETH/USD: $${input.market.ethUsd.toFixed(2)}
- 24h change: ${input.market.change24h.toFixed(2)}%

Decide the next treasury action. Respond in JSON only.`;
}
