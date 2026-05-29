#!/usr/bin/env tsx
/**
 * SECURE-BOX ONLY. Run where the agent key (0x981F…) and the 0G compute broker
 * live — never on an untrusted machine. The key is read from the environment
 * (.env), never hardcoded, never logged.
 *
 *   simulate (default):  pnpm --filter @steward/sdk execute:trustless-canary
 *   send:                pnpm --filter @steward/sdk execute:trustless-canary -- --send
 *   new V2 vault:        pnpm --filter @steward/sdk execute:trustless-canary -- --vault <address> --send
 *
 * One-shot, single-vault driver for a P4 executeStrategyWithPyth() proof on the
 * canary vault. It does NOT modify the TEE / execution flow — it reuses the
 * agent's setupGlobalContext() + executeOneIterationForVault() exactly as the
 * live server does, scoped to the one canary vault address (the live agent never
 * sees it: discoverVaults reads the standard factory, not VaultFactoryV2).
 *
 * Requires ORACLE_MODE=trustless-pyth so the vault path uses executeStrategyWithPyth.
 * Run `preflight:trustless-execution` first; it gates the conditions read-only.
 */

import { setupGlobalContext, executeOneIterationForVault } from "./agent.js";
import { getMarketSnapshot } from "./market.js";
import { initAuditIndex } from "./audit-index.js";
import { initRejectionsLedger } from "./rejections-ledger.js";

const CANARY_VAULT = "0x86cE22c597D0C4EC309ba166360686C39A3f40ed";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function argValue(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
}

function targetVault(): string {
  const vault = argValue("--vault") ?? process.env.TRUSTLESS_VAULT_ADDRESS ?? CANARY_VAULT;
  if (!ADDRESS_RE.test(vault)) {
    console.error("Refusing to run: --vault/TRUSTLESS_VAULT_ADDRESS must be a 20-byte 0x address.");
    process.exit(1);
  }
  return vault;
}

async function main() {
  const send = process.argv.includes("--send");
  const mode = send ? "SEND" : "SIMULATE";
  const vaultAddress = targetVault();
  const isGenesisCanary = vaultAddress.toLowerCase() === CANARY_VAULT.toLowerCase();
  console.log(
    `=== execute-trustless-canary [${mode}] — ${isGenesisCanary ? "Genesis Canary" : "V2 target"} ` +
      `${vaultAddress} ===\n`,
  );

  if (process.env.ORACLE_MODE !== "trustless-pyth") {
    console.error("Refusing to run: set ORACLE_MODE=trustless-pyth (the vault uses executeStrategyWithPyth in this mode).");
    process.exit(1);
  }
  if (!process.env.PRIVATE_KEY) {
    console.error("Refusing to run: PRIVATE_KEY must be provided via the environment (.env on the secure box), not hardcoded.");
    process.exit(1);
  }

  // Initialize the durable audit subsystems the server normally sets up at
  // startup — executeOneIterationForVault persists the TEE reasoning before the
  // tx, and a missing audit index would (correctly) block the execution.
  const ai = initAuditIndex();
  console.log(`audit index : ${ai.writable ? "ready" : "NOT ready"} (${ai.path ?? "no path"})`);
  initRejectionsLedger();

  // Context setup validates the agent wallet, the 0G provider/broker, and the
  // TEE signer-health gate (recovered signer bound to the active AgentINFT).
  const ctx = await setupGlobalContext();
  console.log(`agent wallet : ${ctx.walletAddress}`);
  console.log(`signer health: ${ctx.signerHealth.ok ? "OK (TEE signer bound)" : "BLOCKED"}`);
  if (!ctx.signerHealth.ok) {
    console.error(
      `✗ signer-health gate BLOCKED — provider signer ${ctx.signerHealth.providerSigner} ` +
        `not bound to expected ${ctx.signerHealth.expectedSigner}. Aborting; funds untouched.`,
    );
    process.exit(1);
  }

  const market = await getMarketSnapshot();
  console.log(`market       : ${market.riskSymbol}=$${market.priceUsd.toFixed(5)} (sources ${market.sourceCount}/${market.requiredSourceCount})\n`);

  if (!send) {
    console.log("SIMULATE only — context, broker, signer-health and market are ready.");
    console.log("No inference requested, no transaction sent.");
    console.log("Re-run with `-- --send` to perform the single trustless execution.");
    console.log("(The vault still re-verifies Pyth + slippage on-chain; a swap that cannot clear reverts safely.)");
    return;
  }

  console.log("SEND — writing durable inference, then executing executeStrategyWithPyth...\n");
  const outcome = await executeOneIterationForVault(ctx, vaultAddress, market);
  if (outcome.status === "executed") {
    console.log(`\n=== executed — ${outcome.action} · tx ${outcome.txHash} ===`);
    console.log(`amountIn ${outcome.amountIn} → amountOut ${outcome.amountOut}`);
    console.log("Verify it:");
    console.log(`  pnpm --filter @steward/sdk verify:trustless-execution -- --tx ${outcome.txHash}`);
    console.log(`  pnpm --filter @steward/sdk verify:v2-audit-record -- --tx ${outcome.txHash}`);
  } else {
    console.log(`\n=== ${outcome.status} — ${outcome.reason} ===`);
    console.log("No funds moved. If this is a safe skip (slippage/cooldown/etc.), re-run when conditions allow,");
    console.log("or use one of the documented expected-revert proofs in docs/runbook-p4-trustless-execution.md.");
  }
}

main().catch((err) => {
  console.error("\n💥 execution driver failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
