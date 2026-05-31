#!/usr/bin/env tsx
/**
 * pnpm --filter @steward/sdk preflight:v2-keeper
 * pnpm --filter @steward/sdk preflight:v2-keeper -- --vault <addr>
 *
 * Read-only dry-run of the V2 keeper batch as runCycle() would execute it,
 * without touching the agent key or sending any transaction. Use this before
 * flipping SENTRI_ENABLE_V2_KEEPER=true on Render, and again before adding a
 * user beta vault to the allowlist: it answers, in one shot, "what would the
 * server actually do with V2 next cycle?"
 *
 * Two modes:
 *  - Default (no flag)         : batch dry-run — flag, factory, allowlist,
 *                                OG balance, discover, kept list.
 *  - `--vault <0xaddr>`        : additionally run a per-vault deep check on
 *                                that address: allowlisted, balances,
 *                                cooldown, Pyth fee fetch, audit recovery
 *                                health (if SENTRI_AGENT_URL is reachable),
 *                                and last cycle status. Use this when
 *                                onboarding a beta user vault.
 *
 * Reads (env):
 *  - SENTRI_ENABLE_V2_KEEPER (flag)
 *  - VaultFactoryV2 address (CONTRACTS.vaultFactoryV2 / SENTRI_VAULT_FACTORY_V2_ADDRESS)
 *  - SENTRI_V2_KEEPER_ALLOWLIST (csv 0x addresses)
 *  - SENTRI_V2_KEEPER_MIN_OG_WEI (default 0.5 OG)
 *  - SENTRI_V2_MAX_VAULTS_PER_CYCLE (default 1)
 *  - PRIVATE_KEY (address only — never signs)
 *  - SENTRI_AGENT_URL (optional; if set, the deep check verifies the live
 *    agent has the vault in its tracked state and that the latest audit
 *    entry surfaces reasoning + tx hash + storage root)
 *  - HERMES_URL (default https://hermes.pyth.network)
 *
 * Exit codes:
 *  - 0  V2 batch would run, or is intentionally off; deep check (if any) is clean
 *  - 2  flag ON but a gate would block the batch (allowlist empty / OG floor / etc.)
 *  - 1  hard error (RPC, bad config)
 */

import "dotenv/config";
import { ethers } from "ethers";
import {
  CHAIN,
  CONTRACTS,
  TREASURY_VAULT_ABI,
  V2_KEEPER,
  VAULT_FACTORY_V2_ABI,
} from "./constants.js";

const HERMES = process.env.HERMES_URL ?? "https://hermes.pyth.network";

function fmt(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function argValue(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
}

interface BatchResult {
  ranBatch: boolean;
  kept: string[];
  operatorAddr: string | null;
  operatorBalanceOk: boolean | null;
}

async function batchDryRun(provider: ethers.JsonRpcProvider): Promise<BatchResult> {
  // 1. Master flag
  console.log(`Flag                   : SENTRI_ENABLE_V2_KEEPER=${process.env.SENTRI_ENABLE_V2_KEEPER ?? "(unset)"} → ${V2_KEEPER.enabled ? "ENABLED" : "DISABLED"}`);
  if (!V2_KEEPER.enabled) {
    console.log("\nBATCH VERDICT          : OFF — V2 batch is bypassed at startup (ctx.factoryV2 = null).");
    return { ranBatch: false, kept: [], operatorAddr: null, operatorBalanceOk: null };
  }

  // 2. Factory configured on this network
  const factoryAddr = CONTRACTS.vaultFactoryV2;
  console.log(`Network                : chainId=${CHAIN.id} (${CHAIN.name})`);
  console.log(`VaultFactoryV2         : ${factoryAddr || "(empty — not configured)"}`);
  if (!factoryAddr || factoryAddr === "0x") {
    console.log("\nBATCH VERDICT          : MISCONFIGURED — flag ON but no V2 factory address.");
    return { ranBatch: false, kept: [], operatorAddr: null, operatorBalanceOk: null };
  }

  // 3. Allowlist + cap
  console.log(`Allowlist              : ${V2_KEEPER.allowlist.length} address(es)${V2_KEEPER.allowlist.length > 0 ? " — " + V2_KEEPER.allowlist.map(fmt).join(", ") : ""}`);
  console.log(`Cap per cycle          : ${V2_KEEPER.maxVaultsPerCycle}`);
  console.log(`OG floor               : ${ethers.formatEther(V2_KEEPER.minOgWei)} OG (SENTRI_V2_KEEPER_MIN_OG_WEI)`);

  if (V2_KEEPER.allowlist.length === 0) {
    console.log("\nBATCH VERDICT          : SKIPPED — allowlist empty.");
    return { ranBatch: true, kept: [], operatorAddr: null, operatorBalanceOk: null };
  }

  // 4. Discover via factoryV2
  const factoryV2 = new ethers.Contract(factoryAddr, VAULT_FACTORY_V2_ABI, provider);
  let discovered: string[] = [];
  try {
    const count = Number((await factoryV2.vaultCount()) as bigint);
    for (let i = 0; i < count; i++) {
      const addr = (await factoryV2.allVaults(i)) as string;
      discovered.push(addr);
    }
  } catch (err) {
    console.log(`\nBATCH VERDICT          : ERROR — could not read VaultFactoryV2: ${err instanceof Error ? err.message : err}`);
    return { ranBatch: true, kept: [], operatorAddr: null, operatorBalanceOk: null };
  }
  console.log(`\nDiscovered V2 vaults   : ${discovered.length}`);
  for (const v of discovered) console.log(`  · ${v}`);

  // 5. Apply allowlist + cap
  const allowed = new Set(V2_KEEPER.allowlist);
  const kept = discovered.filter((a) => allowed.has(a.toLowerCase())).slice(0, V2_KEEPER.maxVaultsPerCycle);
  console.log(`Kept after allowlist   : ${kept.length}`);
  for (const v of kept) console.log(`  · ${v}`);

  // 6. Operator OG balance
  const privKey = process.env.PRIVATE_KEY?.trim();
  let operatorAddr: string | null = null;
  let operatorBalanceOk: boolean | null = null;
  if (!privKey) {
    console.log(`\nOperator OG balance    : (skipped — PRIVATE_KEY not set; balance gate cannot be evaluated)`);
  } else {
    try {
      operatorAddr = new ethers.Wallet(privKey).address;
    } catch {
      console.log(`\nOperator OG balance    : (PRIVATE_KEY is set but invalid; gate cannot be evaluated)`);
      operatorAddr = null;
    }
    if (operatorAddr) {
      const balance = await provider.getBalance(operatorAddr);
      const balanceOg = ethers.formatEther(balance);
      const floorOg = ethers.formatEther(V2_KEEPER.minOgWei);
      operatorBalanceOk = balance >= V2_KEEPER.minOgWei;
      console.log(`\nOperator (${fmt(operatorAddr)}) OG balance: ${balanceOg} OG (floor ${floorOg}) → ${operatorBalanceOk ? "OK" : "BELOW FLOOR"}`);
    }
  }

  // 7. Final batch verdict
  if (operatorBalanceOk === false) {
    console.log("\nBATCH VERDICT          : SKIPPED — OG balance below floor. Server would log and skip the V2 batch.");
  } else if (kept.length === 0) {
    console.log("\nBATCH VERDICT          : EMPTY — no allowlisted V2 vault was discovered by the factory.");
  } else {
    console.log("\nBATCH VERDICT          : READY — V2 batch would iterate " + kept.length + " vault(s) next cycle.");
  }

  return { ranBatch: true, kept, operatorAddr, operatorBalanceOk };
}

interface DeepCheckResult {
  blockingFailures: number;
}

async function deepCheckVault(
  provider: ethers.JsonRpcProvider,
  vaultAddr: string,
): Promise<DeepCheckResult> {
  console.log(`\n=== Per-vault deep check — ${vaultAddr} ===\n`);
  let blocking = 0;
  const tick = (label: string, ok: boolean, detail: string, isBlocking = true) => {
    console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(22)} ${detail}`);
    if (!ok && isBlocking) blocking++;
  };

  // 1. Allowlisted?
  const isAllowlisted = V2_KEEPER.allowlist.includes(vaultAddr.toLowerCase());
  tick("allowlisted", isAllowlisted, isAllowlisted ? "yes" : "NOT in SENTRI_V2_KEEPER_ALLOWLIST");

  // 2. Vault state
  const vault = new ethers.Contract(vaultAddr, TREASURY_VAULT_ABI, provider);
  let baseBalance: bigint, riskBalance: bigint, logCount: bigint, killed: boolean, paused: boolean, lastExecutionTime: bigint;
  let cooldownPeriod = 0;
  try {
    const policy = await vault.policy();
    cooldownPeriod = Number(policy[4]);
    [baseBalance, riskBalance, logCount, killed, paused, lastExecutionTime] = await Promise.all([
      vault.vaultBalance() as Promise<bigint>,
      vault.riskBalance() as Promise<bigint>,
      vault.executionLogCount() as Promise<bigint>,
      vault.killed() as Promise<boolean>,
      vault.paused() as Promise<boolean>,
      vault.lastExecutionTime() as Promise<bigint>,
    ]);
  } catch (err) {
    tick("vault state", false, `read failed: ${err instanceof Error ? err.message : err}`);
    return { blockingFailures: blocking };
  }

  tick(
    "vault balances",
    baseBalance > 0n || riskBalance > 0n,
    `base=${ethers.formatUnits(baseBalance, 6)} risk=${ethers.formatUnits(riskBalance, 18)} logs=${logCount}`,
  );
  tick("killed / paused", !killed && !paused, killed ? "KILLED" : paused ? "PAUSED" : "active");

  // 3. Cooldown
  const now = Math.floor(Date.now() / 1000);
  if (lastExecutionTime === 0n) {
    tick("cooldown", true, "n/a (no prior execution)");
  } else {
    const elapsed = now - Number(lastExecutionTime);
    const remaining = Math.max(0, cooldownPeriod - elapsed);
    tick(
      "cooldown",
      remaining === 0,
      remaining === 0 ? `ready (last exec ${elapsed}s ago)` : `${remaining}s remaining (last exec ${elapsed}s ago)`,
      false, // informational — cooldown will elapse on its own
    );
  }

  // 4. Pyth fee fetch
  let pythPriceId: string | undefined;
  let pythAddr: string | undefined;
  try {
    pythPriceId = await vault.pythPriceId() as string;
    pythAddr = await vault.pyth() as string;
  } catch (err) {
    tick("pyth config", false, `vault.pythPriceId/pyth() failed: ${err instanceof Error ? err.message : err}`);
    return { blockingFailures: blocking };
  }
  let updateData: string[] = [];
  try {
    const res = await fetch(`${HERMES}/v2/updates/price/latest?ids[]=${pythPriceId}`);
    if (!res.ok) throw new Error(`Hermes HTTP ${res.status}`);
    const json = (await res.json()) as { binary: { data: string[] } };
    updateData = json.binary.data.map((d) => (d.startsWith("0x") ? d : `0x${d}`));
    if (updateData.length === 0) throw new Error("empty VAA list");
  } catch (err) {
    tick("hermes fetch", false, err instanceof Error ? err.message : String(err));
    return { blockingFailures: blocking };
  }
  let pythFee: bigint;
  try {
    const pyth = new ethers.Contract(
      pythAddr,
      ["function getUpdateFee(bytes[]) view returns (uint256)"],
      provider,
    );
    pythFee = (await pyth.getUpdateFee(updateData)) as bigint;
  } catch (err) {
    tick("pyth fee fetch", false, `getUpdateFee reverted: ${err instanceof Error ? err.message : err}`);
    return { blockingFailures: blocking };
  }
  tick("pyth fee", pythFee > 0n, `${ethers.formatEther(pythFee)} OG (priceId=${pythPriceId.slice(0, 10)}…)`);

  // 5. Keeper OG balance (re-read so the per-vault report is self-contained)
  const privKey = process.env.PRIVATE_KEY?.trim();
  if (!privKey) {
    tick("keeper OG balance", false, "PRIVATE_KEY not set — cannot resolve operator address", false);
  } else {
    let operatorAddr = "";
    try {
      operatorAddr = new ethers.Wallet(privKey).address;
    } catch {
      tick("keeper OG balance", false, "PRIVATE_KEY invalid");
    }
    if (operatorAddr) {
      const bal = await provider.getBalance(operatorAddr);
      const ok = bal >= V2_KEEPER.minOgWei;
      tick(
        "keeper OG balance",
        ok,
        `${ethers.formatEther(bal)} OG (floor ${ethers.formatEther(V2_KEEPER.minOgWei)}) @ ${fmt(operatorAddr)}`,
      );
    }
  }

  // 6. Audit recovery + last cycle status — require live agent endpoint
  const agentUrl = process.env.SENTRI_AGENT_URL?.replace(/\/$/, "");
  if (!agentUrl) {
    tick(
      "audit recovery",
      false,
      "SENTRI_AGENT_URL not set — cannot check live audit recovery",
      false,
    );
    tick("last cycle status", false, "SENTRI_AGENT_URL not set", false);
  } else {
    // a) Latest audit entry — does reasoning + tx + storage root come back?
    try {
      const res = await fetch(`${agentUrl}/vault/${vaultAddr}/audit?limit=1`);
      if (!res.ok) throw new Error(`agent HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      const arr: Array<Record<string, unknown>> = Array.isArray(json)
        ? (json as Array<Record<string, unknown>>)
        : Array.isArray((json as { entries?: unknown }).entries)
          ? ((json as { entries: Array<Record<string, unknown>> }).entries)
          : [];
      const latest = arr[0];
      if (!latest) {
        tick("audit recovery", true, "no audit entry yet (vault never executed)", false);
      } else {
        const hasReasoning = typeof latest.reasoning === "string" && latest.reasoning.length > 0;
        const hasTx = typeof latest.txHash === "string" && latest.txHash.length > 0;
        const hasStorageRoot =
          (typeof latest.canonicalRootHash === "string" && latest.canonicalRootHash.length > 0) ||
          (typeof latest.storageRootHash === "string" && latest.storageRootHash.length > 0);
        const ok = hasReasoning && hasTx && hasStorageRoot;
        tick(
          "audit recovery",
          ok,
          `reasoning=${hasReasoning ? "ok" : "MISSING"} tx=${hasTx ? "ok" : "MISSING"} storageRoot=${hasStorageRoot ? "ok" : "MISSING"}`,
        );
      }
    } catch (err) {
      tick("audit recovery", false, `agent endpoint failed: ${err instanceof Error ? err.message : err}`);
    }
    // b) Last cycle status — is the vault tracked, what's the last outcome?
    try {
      const res = await fetch(`${agentUrl}/healthz`);
      if (!res.ok) throw new Error(`/healthz HTTP ${res.status}`);
      const json = (await res.json()) as { vaults?: Record<string, { totalIterations?: number; lastOutcome?: { status?: string; reason?: string } }> };
      const lower = vaultAddr.toLowerCase();
      const vstate =
        json.vaults?.[vaultAddr] ??
        json.vaults?.[lower] ??
        Object.entries(json.vaults ?? {}).find(([k]) => k.toLowerCase() === lower)?.[1];
      if (!vstate) {
        tick("last cycle status", false, "not tracked yet by the live agent — vault never iterated", false);
      } else {
        const status = vstate.lastOutcome?.status ?? "unknown";
        tick(
          "last cycle status",
          status !== "error",
          `iterations=${vstate.totalIterations ?? 0} lastOutcome=${status}${vstate.lastOutcome?.reason ? ` (${vstate.lastOutcome.reason})` : ""}`,
        );
      }
    } catch (err) {
      tick("last cycle status", false, `agent /healthz failed: ${err instanceof Error ? err.message : err}`, false);
    }
  }

  return { blockingFailures: blocking };
}

async function main(): Promise<void> {
  const vaultArg = argValue("--vault");
  console.log("=== preflight: V2 keeper batch (read-only) ===\n");
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  const batch = await batchDryRun(provider);

  if (!vaultArg) {
    // No deep check requested — exit based on batch verdict.
    if (!V2_KEEPER.enabled) process.exit(0);
    if (batch.operatorBalanceOk === false || batch.kept.length === 0) process.exit(2);
    process.exit(0);
  }

  // Per-vault deep check
  if (!/^0x[0-9a-fA-F]{40}$/.test(vaultArg)) {
    console.error(`\n--vault expects a 20-byte 0x address, got: ${vaultArg}`);
    process.exit(1);
  }
  const deep = await deepCheckVault(provider, vaultArg);
  if (deep.blockingFailures > 0) {
    console.log(`\nDEEP VERDICT           : ${deep.blockingFailures} blocking check(s) failed. Resolve before activating.`);
    process.exit(2);
  }
  console.log(`\nDEEP VERDICT           : OK — vault is keeper-ready (modulo cooldown, which clears on its own).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n💥 preflight failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
