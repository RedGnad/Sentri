#!/usr/bin/env tsx
/**
 * pnpm --filter @steward/sdk preflight:v2-keeper
 *
 * Read-only dry-run of the V2 keeper batch as runCycle() would execute it,
 * without touching the agent key or sending any transaction. Use this before
 * flipping SENTRI_ENABLE_V2_KEEPER=true on Render: it answers, in one shot,
 * "what would the server actually do with V2 next cycle?"
 *
 * Reads:
 *  - SENTRI_ENABLE_V2_KEEPER (flag)
 *  - VaultFactoryV2 address (CONTRACTS.vaultFactoryV2)
 *  - SENTRI_V2_KEEPER_ALLOWLIST (comma-separated 0x addresses)
 *  - SENTRI_V2_KEEPER_MIN_OG_WEI (default 0.5 OG)
 *  - SENTRI_V2_MAX_VAULTS_PER_CYCLE (default 1)
 *  - Operator wallet OG balance (from PRIVATE_KEY — only the address is used,
 *    no signing). If PRIVATE_KEY is unset the balance check is reported as
 *    inconclusive but the rest of the report still runs.
 *
 * Exit codes:
 *  - 0 — V2 batch would run (or is intentionally off; see VERDICT)
 *  - 2 — flag ON but a gate would block the batch (allowlist empty / OG floor)
 *  - 1 — hard error (RPC, bad config)
 */

import "dotenv/config";
import { ethers } from "ethers";
import {
  CHAIN,
  CONTRACTS,
  V2_KEEPER,
  VAULT_FACTORY_V2_ABI,
} from "./constants.js";

function fmt(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function main(): Promise<void> {
  console.log("=== preflight: V2 keeper batch (read-only) ===\n");

  // 1. Master flag
  console.log(`Flag                   : SENTRI_ENABLE_V2_KEEPER=${process.env.SENTRI_ENABLE_V2_KEEPER ?? "(unset)"} → ${V2_KEEPER.enabled ? "ENABLED" : "DISABLED"}`);
  if (!V2_KEEPER.enabled) {
    console.log("\nVERDICT                : OFF — V2 batch is bypassed at startup (ctx.factoryV2 = null).");
    console.log("                         No action needed unless the canary is meant to start auto-cycling.");
    process.exit(0);
  }

  // 2. Factory configured on this network
  const factoryAddr = CONTRACTS.vaultFactoryV2;
  console.log(`Network                : chainId=${CHAIN.id} (${CHAIN.name})`);
  console.log(`VaultFactoryV2         : ${factoryAddr || "(empty — not configured)"}`);
  if (!factoryAddr || factoryAddr === "0x") {
    console.log("\nVERDICT                : MISCONFIGURED — flag ON but no V2 factory address.");
    console.log("                         Set SENTRI_VAULT_FACTORY_V2_ADDRESS or deploy V2 on this network.");
    process.exit(2);
  }

  // 3. Allowlist + cap
  console.log(`Allowlist              : ${V2_KEEPER.allowlist.length} address(es)${V2_KEEPER.allowlist.length > 0 ? " — " + V2_KEEPER.allowlist.map(fmt).join(", ") : ""}`);
  console.log(`Cap per cycle          : ${V2_KEEPER.maxVaultsPerCycle}`);
  console.log(`OG floor               : ${ethers.formatEther(V2_KEEPER.minOgWei)} OG (SENTRI_V2_KEEPER_MIN_OG_WEI)`);

  if (V2_KEEPER.allowlist.length === 0) {
    console.log("\nVERDICT                : SKIPPED — allowlist empty. Server would log a warning and not iterate.");
    console.log("                         Set SENTRI_V2_KEEPER_ALLOWLIST=0x… before enabling.");
    process.exit(2);
  }

  // 4. Discover via factoryV2 (read-only — no keys required)
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  const factoryV2 = new ethers.Contract(factoryAddr, VAULT_FACTORY_V2_ABI, provider);
  let discovered: string[] = [];
  try {
    const count = Number((await factoryV2.vaultCount()) as bigint);
    for (let i = 0; i < count; i++) {
      const addr = (await factoryV2.allVaults(i)) as string;
      discovered.push(addr);
    }
  } catch (err) {
    console.log(`\nVERDICT                : ERROR — could not read VaultFactoryV2: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  console.log(`\nDiscovered V2 vaults   : ${discovered.length}`);
  for (const v of discovered) console.log(`  · ${v}`);

  // 5. Apply allowlist + cap
  const allowed = new Set(V2_KEEPER.allowlist);
  const kept = discovered.filter((a) => allowed.has(a.toLowerCase())).slice(0, V2_KEEPER.maxVaultsPerCycle);
  console.log(`Kept after allowlist   : ${kept.length}`);
  for (const v of kept) console.log(`  · ${v}`);

  // 6. Operator OG balance (best-effort — derive address from PRIVATE_KEY without signing)
  const privKey = process.env.PRIVATE_KEY?.trim();
  if (!privKey) {
    console.log(`\nOperator OG balance    : (skipped — PRIVATE_KEY not set; balance gate cannot be evaluated)`);
    console.log("\nVERDICT                : DRY — discovery + allowlist would yield " + kept.length + " vault(s).");
    console.log("                         Run again with PRIVATE_KEY set to evaluate the OG-balance gate.");
    process.exit(kept.length > 0 ? 0 : 2);
  }
  let operatorAddr = "";
  try {
    operatorAddr = new ethers.Wallet(privKey).address;
  } catch {
    console.log(`\nOperator OG balance    : (PRIVATE_KEY is set but invalid; gate cannot be evaluated)`);
    process.exit(1);
  }
  const balance = await provider.getBalance(operatorAddr);
  const balanceOg = ethers.formatEther(balance);
  const floorOg = ethers.formatEther(V2_KEEPER.minOgWei);
  const balanceOk = balance >= V2_KEEPER.minOgWei;
  console.log(`\nOperator (${fmt(operatorAddr)})  OG balance: ${balanceOg} OG (floor ${floorOg}) → ${balanceOk ? "OK" : "BELOW FLOOR"}`);

  // 7. Final verdict
  if (!balanceOk) {
    console.log("\nVERDICT                : SKIPPED — OG balance below floor. Server would log and skip the V2 batch.");
    console.log("                         Top up the operator wallet, or lower SENTRI_V2_KEEPER_MIN_OG_WEI.");
    process.exit(2);
  }
  if (kept.length === 0) {
    console.log("\nVERDICT                : EMPTY — no allowlisted V2 vault was discovered by the factory.");
    console.log("                         Verify the canary address or factory address.");
    process.exit(2);
  }
  console.log("\nVERDICT                : READY — V2 batch would iterate " + kept.length + " vault(s) next cycle.");
  console.log("                         Tip: run `pnpm --filter @steward/sdk preflight:trustless-execution` for the deep canary check.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n💥 preflight failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
