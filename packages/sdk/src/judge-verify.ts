#!/usr/bin/env tsx
/**
 * pnpm --filter @steward/sdk judge:verify -- --tx <hash>
 *
 * Single-command judge-friendly proof for one V2 trustless execution.
 * Runs verify:trustless-execution (Pyth same-tx + TEE signer-bound + policy
 * checks + explorer) and prints a clean summary box: explorer links, 0G
 * Storage anchors for the audit blob (when the tx is the canonical Genesis
 * execution), docs pointers, and one final VERDICT.
 *
 * Read-only. No private key, no broker, no chain writes.
 */

import { spawnSync } from "node:child_process";

const EXPLORER = "https://chainscan.0g.ai";
const VAULT = "0x86cE22c597D0C4EC309ba166360686C39A3f40ed";
const PYTH = "0x2880aB155794e7179c9eE2e38200202908C17B43";
const AGENT_INFT = "0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951";

// Canonical Genesis V2 execution. When --tx matches this, judge:verify can
// surface the off-chain 0G Storage anchors for the audit blob as well.
const CANONICAL_TX = "0x45ab1a82282d72850c11e16f19e912e60ba89d491d42d5f8010b0bf0df7317fa";
const CANONICAL_AUDIT_ROOT = "0x66345ddfd28a0121e1d7916f51ae0d833a0a5d5293d4e438396cf3df4928063e";
const CANONICAL_AUDIT_STORAGE_TX = "0x0d53bca76c79323dd2d6978716b0996d7026e46d6f067e16a9e5a6a5e69b65ab";

const bar = "════════════════════════════════════════════════════════════════";

function parseTx(): string {
  const i = process.argv.indexOf("--tx");
  const tx = i >= 0 ? process.argv[i + 1] : undefined;
  if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx)) {
    console.error("Usage: judge:verify -- --tx <0x… 32-byte tx hash>");
    process.exit(1);
  }
  return tx;
}

function main() {
  const tx = parseTx();
  const isCanonical = tx.toLowerCase() === CANONICAL_TX.toLowerCase();

  console.log(bar);
  console.log("  Sentri · judge:verify · single-command proof");
  console.log(bar);
  console.log("");

  const r = spawnSync(
    "pnpm",
    ["verify:trustless-execution", "--", "--tx", tx],
    { stdio: "inherit" },
  );
  const trustlessOk = r.status === 0;

  console.log("");
  console.log(bar);
  console.log("  Summary");
  console.log(bar);
  console.log(`  on-chain trustless execution : ${trustlessOk ? "PASS" : "FAIL"}`);
  console.log("");
  console.log(`  Explorer (on-chain)`);
  console.log(`    tx        : ${EXPLORER}/tx/${tx}`);
  console.log(`    vault     : ${EXPLORER}/address/${VAULT}`);
  console.log(`    Pyth      : ${EXPLORER}/address/${PYTH}`);
  console.log(`    AgentINFT : ${EXPLORER}/address/${AGENT_INFT}`);
  if (isCanonical) {
    console.log("");
    console.log(`  Off-chain audit blob (0G Storage anchors)`);
    console.log(`    canonical root : ${CANONICAL_AUDIT_ROOT}`);
    console.log(`    storage tx     : ${EXPLORER}/tx/${CANONICAL_AUDIT_STORAGE_TX}`);
    console.log(`    blob retrieval : 0G Storage indexer  https://indexer-storage-turbo.0g.ai`);
    console.log(`                     (download by root via @0gfoundation/0g-ts-sdk Indexer.download)`);
  }
  console.log("");
  console.log(`  Docs    : JUDGE_ORACLE_PROOF.md · JUDGE_TEE_TRUST_BOUNDARY.md`);
  console.log("");
  console.log(`  VERDICT : ${trustlessOk ? "PASS" : "FAIL"}`);
  console.log(bar);

  process.exit(trustlessOk ? 0 : 1);
}

main();
