// CLI diagnostic — read-only vault inspector.
//
// Explains, for any TreasuryVault, why the agent executed or skipped: balances,
// drawdown vs the strategy trigger, allocation headroom, cooldown, price
// freshness — plus a plain-language verdict. No private key required.
//
// Run:
//   pnpm --filter @steward/sdk inspect-vault 0xVault1 [0xVault2 ...]
//   VAULT_ADDRESS=0xVault1,0xVault2 pnpm --filter @steward/sdk inspect-vault
//
// Env (optional): RPC_URL, PRICE_FEED_ADDRESS (else src/constants.ts defaults,
// network selected by SENTRI_NETWORK).

import "dotenv/config";
import { ethers } from "ethers";
import { CHAIN, CONTRACTS, TREASURY_VAULT_ABI, ERC20_ABI, PRICE_FEED_ABI } from "./constants.js";
import { DRAWDOWN_BREACH_PCT, MIN_RISK_POSITION_USD } from "./strategy-constants.js";

interface PriceInfo {
  price: number | null;
  ageSec: number | null;
}

async function readPrice(provider: ethers.Provider): Promise<PriceInfo> {
  try {
    const feed = new ethers.Contract(CONTRACTS.priceFeed, PRICE_FEED_ABI, provider);
    const [decimals, round] = await Promise.all([feed.decimals(), feed.latestRoundData()]);
    const price = Number(ethers.formatUnits(round[1], Number(decimals)));
    const ageSec = Math.floor(Date.now() / 1000) - Number(round[3]);
    return { price, ageSec };
  } catch {
    return { price: null, ageSec: null };
  }
}

/** Resolve a contract read to a fallback instead of throwing (some views revert on stale price). */
async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

interface VaultReport {
  address: string;
  ok: boolean;
  error?: string;
  baseSymbol: string;
  riskSymbol: string;
  baseBalance: number;
  riskBalance: number;
  riskValueUsd: number | null;
  tvl: number | null;
  hwm: number;
  drawdownPct: number | null;
  riskSharePct: number | null;
  maxAllocationPct: number;
  maxDrawdownPct: number;
  remainingHeadroomPct: number | null;
  cooldownSec: number;
  cooldownRemainingSec: number;
  executionLogCount: number;
  paused: boolean;
  killed: boolean;
  priceStale: boolean;
  verdict: string;
}

async function inspect(
  provider: ethers.Provider,
  address: string,
  price: PriceInfo,
): Promise<VaultReport> {
  const blank = (error: string): VaultReport => ({
    address, ok: false, error, baseSymbol: "?", riskSymbol: "?", baseBalance: 0,
    riskBalance: 0, riskValueUsd: null, tvl: null, hwm: 0, drawdownPct: null,
    riskSharePct: null, maxAllocationPct: 0, maxDrawdownPct: 0, remainingHeadroomPct: null,
    cooldownSec: 0, cooldownRemainingSec: 0, executionLogCount: 0, paused: false,
    killed: false, priceStale: false, verdict: "n/a",
  });

  const vault = new ethers.Contract(address, TREASURY_VAULT_ABI, provider);

  let baseAddr: string, riskAddr: string;
  try {
    [baseAddr, riskAddr] = await Promise.all([vault.base(), vault.risk()]);
  } catch (err) {
    return blank(`not a readable TreasuryVault: ${err instanceof Error ? err.message : String(err)}`);
  }

  const baseToken = new ethers.Contract(baseAddr, ERC20_ABI, provider);
  const riskToken = new ethers.Contract(riskAddr, ERC20_ABI, provider);
  const [baseDec, riskDec, baseSymbol, riskSymbol] = await Promise.all([
    safe(baseToken.decimals(), 18n).then(Number),
    safe(riskToken.decimals(), 18n).then(Number),
    safe<string>(baseToken.symbol(), "BASE"),
    safe<string>(riskToken.symbol(), "RISK"),
  ]);

  const [vb, rb, hwm, policy, paused, killed, lastExec, logCount] = await Promise.all([
    vault.vaultBalance() as Promise<bigint>,
    vault.riskBalance() as Promise<bigint>,
    vault.highWaterMark() as Promise<bigint>,
    vault.policy() as Promise<[bigint, bigint, bigint, bigint, bigint, bigint]>,
    vault.paused() as Promise<boolean>,
    vault.killed() as Promise<boolean>,
    vault.lastExecutionTime() as Promise<bigint>,
    vault.executionLogCount() as Promise<bigint>,
  ]);

  const baseBalance = Number(ethers.formatUnits(vb, baseDec));
  const riskBalance = Number(ethers.formatUnits(rb, riskDec));
  const hwmN = Number(ethers.formatUnits(hwm, baseDec));
  const maxAllocationPct = Number(policy[0]) / 100;
  const maxDrawdownPct = Number(policy[1]) / 100;
  const cooldownSec = Number(policy[4]);
  const maxStalenessSec = Number(policy[5]);

  const riskValueUsd = price.price != null ? riskBalance * price.price : null;
  const tvl = riskValueUsd != null ? baseBalance + riskValueUsd : null;
  const drawdownPct =
    tvl != null && hwmN > 0 ? Math.max(0, ((hwmN - tvl) / hwmN) * 100) : null;
  const riskSharePct = tvl != null && tvl > 0 && riskValueUsd != null
    ? (riskValueUsd / tvl) * 100
    : null;
  const remainingHeadroomPct = riskSharePct != null ? maxAllocationPct - riskSharePct : null;

  const now = Math.floor(Date.now() / 1000);
  const cooldownRemainingSec = Math.max(0, Number(lastExec) + cooldownSec - now);
  const priceStale = price.ageSec == null || price.ageSec > maxStalenessSec;

  // Read-only prediction of the agent's next move. The exact regime also
  // depends on live market data (24h change, oracle spread) the agent fetches
  // off-chain, so this is a best-effort verdict, stated as such.
  let verdict: string;
  if (killed) {
    verdict = "KILLED — kill-switch engaged; autonomous execution is stopped. Funds remain withdrawable.";
  } else if (paused) {
    verdict = "PAUSED — execution suspended by the vault owner.";
  } else if (tvl != null && tvl === 0) {
    verdict = "IDLE — the vault is empty; deposit funds for the agent to manage.";
  } else if (cooldownRemainingSec > 0) {
    verdict = `COOLDOWN — ${cooldownRemainingSec}s remaining before the next action is allowed.`;
  } else if (drawdownPct != null && drawdownPct >= DRAWDOWN_BREACH_PCT) {
    verdict =
      riskValueUsd != null && riskValueUsd < MIN_RISK_POSITION_USD
        ? `DEFENSIVE HOLD — drawdown ${drawdownPct.toFixed(2)}% is past the strategy trigger ` +
          `(${DRAWDOWN_BREACH_PCT}%) and the vault is already fully deleveraged ` +
          `(risk ≈ ${riskValueUsd.toFixed(6)} USD < ${MIN_RISK_POSITION_USD} dust threshold). ` +
          `Nothing left to sell — the agent skips. Not broken; funds are safe.`
        : `DEFENSIVE — drawdown ${drawdownPct.toFixed(2)}% is past the strategy trigger ` +
          `(${DRAWDOWN_BREACH_PCT}%); the agent will likely run EmergencyDeleverage next cycle.`;
  } else if (remainingHeadroomPct != null && remainingHeadroomPct <= 0.01) {
    verdict =
      `TARGET REACHED — risk share ${riskSharePct?.toFixed(2)}% is at the policy max allocation ` +
      `(${maxAllocationPct}%). Rebalances are skipped until drift or headroom returns.`;
  } else if (priceStale) {
    verdict =
      "PRICE STALE — the on-chain price is older than the policy staleness window. " +
      "The runner refreshes the price at the start of each cycle before executing.";
  } else {
    verdict =
      "ELIGIBLE — within normal operating range. The next action (hold / rebalance / " +
      "deleverage) depends on the live market regime the agent classifies off-chain.";
  }

  return {
    address, ok: true, baseSymbol, riskSymbol, baseBalance, riskBalance, riskValueUsd,
    tvl, hwm: hwmN, drawdownPct, riskSharePct, maxAllocationPct, maxDrawdownPct,
    remainingHeadroomPct, cooldownSec, cooldownRemainingSec,
    executionLogCount: Number(logCount), paused, killed, priceStale, verdict,
  };
}

function printReport(r: VaultReport, price: PriceInfo): void {
  console.log("");
  console.log(`Vault ${r.address}`);
  console.log("─".repeat(60));
  if (!r.ok) {
    console.log(`  ERROR: ${r.error}`);
    return;
  }
  const n = (v: number | null, d = 6) => (v == null ? "n/a" : v.toFixed(d));
  console.log(`  paused / killed         : ${r.paused} / ${r.killed}`);
  console.log(`  base balance            : ${n(r.baseBalance)} ${r.baseSymbol}`);
  console.log(`  risk balance            : ${n(r.riskBalance, 9)} ${r.riskSymbol}`);
  console.log(`  risk value (USD)        : ${n(r.riskValueUsd, 8)}`);
  console.log(`  TVL                     : ${n(r.tvl)}`);
  console.log(`  high-water mark         : ${n(r.hwm)}`);
  console.log(`  drawdown from HWM       : ${r.drawdownPct == null ? "n/a" : r.drawdownPct.toFixed(3) + "%"}`);
  console.log(`  strategy drawdown trig. : ${DRAWDOWN_BREACH_PCT}%   (off-chain regime classifier)`);
  console.log(`  policy max drawdown     : ${r.maxDrawdownPct}%   (on-chain hard guard)`);
  console.log(`  policy max allocation   : ${r.maxAllocationPct}%`);
  console.log(`  current risk share      : ${r.riskSharePct == null ? "n/a" : r.riskSharePct.toFixed(3) + "%"}`);
  console.log(`  remaining headroom      : ${r.remainingHeadroomPct == null ? "n/a" : r.remainingHeadroomPct.toFixed(3) + "%"}`);
  console.log(`  dust threshold (USD)    : ${MIN_RISK_POSITION_USD}`);
  console.log(`  cooldown                : ${r.cooldownSec}s  (remaining: ${r.cooldownRemainingSec}s)`);
  console.log(`  price / age             : ${price.price ?? "n/a"} USD / ${price.ageSec == null ? "n/a" : price.ageSec + "s"}`);
  console.log(`  price status            : ${r.priceStale ? "STALE (vs policy staleness)" : "fresh"}`);
  console.log(`  on-chain executions     : ${r.executionLogCount}`);
  console.log(`  VERDICT: ${r.verdict}`);
}

async function main(): Promise<void> {
  const fromArgs = process.argv.slice(2);
  const fromEnv = (process.env.VAULT_ADDRESS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const addresses = (fromArgs.length > 0 ? fromArgs : fromEnv).filter(Boolean);

  if (addresses.length === 0) {
    console.error(
      "Usage: pnpm --filter @steward/sdk inspect-vault 0xVault1 [0xVault2 ...]\n" +
        "   or: VAULT_ADDRESS=0xVault1,0xVault2 pnpm --filter @steward/sdk inspect-vault",
    );
    process.exitCode = 1;
    return;
  }

  const rpcUrl = process.env.RPC_URL?.trim() || CHAIN.rpcUrl;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const price = await readPrice(provider);

  console.log("");
  console.log("Sentri — vault inspector (read-only)");
  console.log("════════════════════════════════════");
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Price feed: ${CONTRACTS.priceFeed} → ${price.price ?? "n/a"} USD` +
    (price.ageSec != null ? ` (age ${price.ageSec}s)` : ""));

  for (const address of addresses) {
    try {
      const report = await inspect(provider, address, price);
      printReport(report, price);
    } catch (err) {
      console.log(`\nVault ${address}\n` + "─".repeat(60));
      console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log("");
}

main().catch((err: unknown) => {
  console.error(`inspect-vault failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
