import { ethers } from "ethers";
import "dotenv/config";
import { CHAIN, CONTRACTS, TREASURY_VAULT_ABI, ERC20_ABI, AGENT } from "./constants.js";
import {
  initInference,
  selectProvider,
  acknowledgeProvider,
  requestInference,
  TREASURY_SYSTEM_PROMPT,
} from "./inference.js";
import { initStorage, appendAuditLog, savePortfolioState } from "./storage.js";

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

// ── Helpers ───────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function getEnvOrThrow(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

// ── Agent Loop ────────────────────────────────────────────────────────────

async function runAgentLoop(): Promise<void> {
  const privateKey = getEnvOrThrow("PRIVATE_KEY");
  const vaultAddress = CONTRACTS.treasuryVault || getEnvOrThrow("NEXT_PUBLIC_TREASURY_VAULT_ADDRESS");
  const usdcAddress = CONTRACTS.mockUSDC || getEnvOrThrow("NEXT_PUBLIC_MOCK_USDC_ADDRESS");

  // Initialize provider + contracts
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const vault = new ethers.Contract(vaultAddress, TREASURY_VAULT_ABI, wallet);
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, wallet);

  // Initialize 0G services
  log("Initializing 0G Sealed Inference broker...");
  await initInference(privateKey);

  log("Selecting inference provider...");
  const providerInfo = await selectProvider();
  log(`Provider: ${providerInfo.address} | Model: ${providerInfo.model}`);

  log("Acknowledging provider TEE signer...");
  await acknowledgeProvider();

  log("Initializing 0G Storage...");
  initStorage(privateKey);

  log("Agent initialized. Starting loop.\n");

  // Main loop
  while (true) {
    try {
      await executeOneIteration(vault, usdc, wallet);
    } catch (err) {
      log(`ERROR in agent iteration: ${err instanceof Error ? err.message : err}`);
    }

    log(`Sleeping ${AGENT.loopIntervalMs / 1000}s until next iteration...\n`);
    await new Promise((r) => setTimeout(r, AGENT.loopIntervalMs));
  }
}

async function executeOneIteration(
  vault: ethers.Contract,
  usdc: ethers.Contract,
  wallet: ethers.Wallet,
): Promise<void> {
  // 1. Check if vault is killed or paused
  const isKilled = await vault.killed();
  if (isKilled) {
    log("Vault is KILLED. Agent shutting down.");
    process.exit(0);
  }

  const isPaused = await vault.paused();
  if (isPaused) {
    log("Vault is PAUSED. Skipping iteration.");
    return;
  }

  // 2. Fetch current vault state
  const [balance, hwm, policy, logCount] = await Promise.all([
    vault.vaultBalance(),
    vault.highWaterMark(),
    vault.policy(),
    vault.executionLogCount(),
  ]);

  const balanceStr = ethers.formatUnits(balance, 6);
  const hwmStr = ethers.formatUnits(hwm, 6);

  log(`Vault balance: ${balanceStr} USDC | HWM: ${hwmStr} USDC | Executions: ${logCount}`);

  if (balance === 0n) {
    log("Vault is empty. Skipping iteration.");
    return;
  }

  // 3. Build market data prompt (simulate market snapshot)
  const prompt = buildMarketPrompt(balanceStr, hwmStr, {
    maxAllocationBps: Number(policy[0]),
    maxDrawdownBps: Number(policy[1]),
    rebalanceThresholdBps: Number(policy[2]),
    cooldownPeriod: Number(policy[3]),
  });

  // 4. Request private analysis via Sealed Inference (TEE)
  log("Requesting Sealed Inference analysis (TEE)...");
  const inference = await requestInference(prompt, TREASURY_SYSTEM_PROMPT);
  log(`TEE verified: ${inference.verified} | ChatID: ${inference.chatID}`);

  // 5. Parse the LLM decision
  let decision: AgentDecision;
  try {
    decision = JSON.parse(inference.content) as AgentDecision;
  } catch {
    log(`Failed to parse LLM response: ${inference.content.slice(0, 200)}`);
    return;
  }

  log(`Decision: ${decision.action} | Amount: ${decision.amount_bps} bps | Confidence: ${decision.confidence}%`);
  log(`Reasoning: ${decision.reasoning}`);

  // 6. Skip if no action needed
  if (decision.amount_bps === 0) {
    log("No action needed. Skipping execution.");
    return;
  }

  // 7. Calculate amount and check policy compliance locally
  const amount = (balance * BigInt(decision.amount_bps)) / 10000n;
  const maxAllocation = (balance * BigInt(policy[0])) / 10000n;

  if (amount > maxAllocation) {
    log(`Amount ${ethers.formatUnits(amount, 6)} exceeds max allocation ${ethers.formatUnits(maxAllocation, 6)}. Capping.`);
    // Cap at max allocation
    decision.amount_bps = Number(policy[0]);
  }

  const execAmount = (balance * BigInt(decision.amount_bps)) / 10000n;

  // 8. Execute on-chain
  log(`Executing on-chain: ${decision.action} for ${ethers.formatUnits(execAmount, 6)} USDC...`);

  try {
    const tx = await vault.executeStrategy(
      ACTION_MAP[decision.action],
      execAmount,
      inference.proofHash,
      inference.teeAttestation,
    );
    const receipt = await tx.wait();
    log(`TX confirmed: ${receipt.hash}`);

    // 9. Log to 0G Storage (immutable audit trail)
    log("Saving audit entry to 0G Storage...");
    await appendAuditLog({
      timestamp: Date.now(),
      action: decision.action,
      amount: ethers.formatUnits(execAmount, 6),
      proofHash: inference.proofHash,
      teeAttestation: inference.teeAttestation,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      txHash: receipt.hash,
    });

    // 10. Update portfolio state in 0G KV
    const newBalance = BigInt(await vault.vaultBalance());
    const newHwm = BigInt(await vault.highWaterMark());
    const newLogCount = Number(await vault.executionLogCount());

    await savePortfolioState({
      vaultBalance: ethers.formatUnits(newBalance, 6),
      highWaterMark: ethers.formatUnits(newHwm, 6),
      lastAction: decision.action,
      lastActionTime: Date.now(),
      totalExecutions: newLogCount,
      pnlBps: newHwm > 0n ? Number(((newBalance - newHwm) * 10000n) / newHwm) : 0,
    });

    log("Iteration complete.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("CooldownNotElapsed")) {
      log("Cooldown not elapsed. Skipping execution.");
    } else if (msg.includes("AllocationExceeded")) {
      log("Allocation exceeded policy. Skipping.");
    } else if (msg.includes("DrawdownBreached")) {
      log("Drawdown breached policy. Skipping.");
    } else {
      throw err;
    }
  }
}

function buildMarketPrompt(
  balance: string,
  hwm: string,
  policy: { maxAllocationBps: number; maxDrawdownBps: number; rebalanceThresholdBps: number; cooldownPeriod: number },
): string {
  return `Current Treasury State:
- Vault Balance: ${balance} USDC
- High Water Mark: ${hwm} USDC
- P&L from HWM: ${Number(hwm) > 0 ? (((Number(balance) - Number(hwm)) / Number(hwm)) * 100).toFixed(2) : "0"}%

Risk Policy:
- Max Allocation per Action: ${policy.maxAllocationBps / 100}%
- Max Drawdown from HWM: ${policy.maxDrawdownBps / 100}%
- Rebalance Threshold: ${policy.rebalanceThresholdBps / 100}%
- Cooldown Period: ${policy.cooldownPeriod}s

Market Conditions (simulated for testnet):
- USDC peg: $1.0001
- ETH/USD: $3,245 (24h change: -1.2%)
- Market volatility (VIX): 18.5 (moderate)
- DeFi TVL trend: stable

Based on the above, what action should the treasury take?`;
}

// ── Entry Point ───────────────────────────────────────────────────────────

runAgentLoop().catch((err) => {
  console.error("Fatal agent error:", err);
  process.exit(1);
});
