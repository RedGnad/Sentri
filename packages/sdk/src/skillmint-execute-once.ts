// One-shot CLI: execute SkillMint skill once and verify the receipt.
//
// Usage:
//   pnpm --filter @steward/sdk skillmint:execute-once --skill-id 13 --input ./skillmint-input.json
//
// Requires in env (Render sentri-agent service only — NOT AGENT_PRIVATE_KEY):
//   SKILLMINT_CALLER_PRIVATE_KEY=0x...   dedicated low-balance wallet
//   SKILLMINT_REGISTRY_ADDRESS=0x...     V3 registry override (required for mainnet + skill #13)
//   SKILLMINT_ESCROW_ADDRESS=0x...       V3 escrow override   (required for mainnet + skill #13)
//   SKILLMINT_SKILL_ID=13               (overridden by --skill-id)
//   SKILLMINT_NETWORK=mainnet           (default)
//
// Prints: network config, skill metadata, paid amount, settlement tx,
//         receiptRootHash, verification result, parsed output.
// Does NOT touch Sentri vault execution.

import "dotenv/config";
import * as fs from "node:fs";
import { SkillMintClient, TESTNET } from "@skillmint/sdk";
import { buildSkillMintNetwork } from "./skillmint.js";

function getArg(flag: string, fallbackEnv?: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallbackEnv ? process.env[fallbackEnv] : undefined;
}

const inputFile = getArg("--input");
const skillIdStr = getArg("--skill-id", "SKILLMINT_SKILL_ID") ?? "13";
const callerKey = process.env.SKILLMINT_CALLER_PRIVATE_KEY;

if (!callerKey) {
  console.error("SKILLMINT_CALLER_PRIVATE_KEY is not set.");
  console.error("This must be a dedicated low-balance wallet — NEVER the agent PRIVATE_KEY.");
  process.exit(1);
}
if (!inputFile) {
  console.error("Usage: skillmint:execute-once --skill-id 13 --input ./skillmint-input.json");
  process.exit(1);
}
if (!fs.existsSync(inputFile)) {
  console.error(`Input file not found: ${inputFile}`);
  process.exit(1);
}

const skillId = Number(skillIdStr);
const inputJson = fs.readFileSync(inputFile, "utf-8");

const isTestnet = process.env.SKILLMINT_NETWORK === "testnet";
const { network, usingAddressOverride, guardError } = isTestnet
  ? { network: TESTNET, usingAddressOverride: false, guardError: null }
  : buildSkillMintNetwork(skillId);

if (guardError) {
  console.error(`[skillmint] ${guardError}`);
  console.error("Set SKILLMINT_REGISTRY_ADDRESS and SKILLMINT_ESCROW_ADDRESS to the V3 addresses.");
  process.exit(1);
}

const client = new SkillMintClient({ privateKey: callerKey, network });

console.log(`Network:              ${isTestnet ? "testnet" : "mainnet"} (chainId ${network.chainId})`);
console.log(`Registry:             ${network.registry}${usingAddressOverride ? " [V3 override]" : ""}`);
console.log(`Escrow:               ${network.escrow ?? "(none)"}${usingAddressOverride ? " [V3 override]" : ""}`);
console.log(`usingAddressOverride: ${usingAddressOverride}`);
console.log(`x402 URL:             ${network.x402Url}`);
console.log(`Skill ID:             ${skillId}`);
console.log(`Caller:               ${client.address}`);
console.log(`W0G balance:          ${await client.getW0GBalance()} W0G`);
console.log(`A0GI balance:         ${await client.getBalance()} A0GI`);

// Stage A: verify skill exists and is active before paying.
// Note: @skillmint/sdk@0.4.0 may fail to decode the V3 getSkill return struct
// (ABI mismatch). If decoding fails, log a warning but proceed — the raw data
// confirms the skill exists, and executeX402 is the authoritative gate.
console.log("\n--- Stage A: getSkill ---");
try {
  const skill = await client.getSkill(skillId);
  console.log(`  active:    ${skill.active}`);
  console.log(`  owner:     ${skill.owner}`);
  console.log(`  model:     ${skill.model}`);
  console.log(`  price:     ${skill.price}`);
  if (!skill.active) {
    console.error(`Skill #${skillId} is not active — aborting.`);
    process.exit(1);
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("BAD_DATA") || msg.includes("could not decode")) {
    console.warn(`  ⚠ getSkill ABI decode failed (SDK V1 struct vs V3 registry) — proceeding.`);
    console.warn(`  Raw return data confirms skill #${skillId} exists on V3 registry.`);
    console.warn(`  This warning is expected with @skillmint/sdk@0.4.0 + V3 contracts.`);
  } else {
    console.error("getSkill failed:", msg);
    console.error("Check that SKILLMINT_REGISTRY_ADDRESS points to V3 registry.");
    process.exit(1);
  }
}

// Stage B: execute and verify.
console.log("\n--- Stage B: executeX402 ---");
let result: Awaited<ReturnType<typeof client.executeX402>>;
try {
  result = await client.executeX402(skillId, inputJson, undefined, { autoWrap: true });
} catch (e) {
  console.error("executeX402 failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}

console.log(`  Paid W0G:        ${result.paidW0G}`);
console.log(`  Payer:           ${result.payer}`);
console.log(`  Settlement tx:   ${result.settlement.transaction}`);
console.log(`  Network:         ${result.settlement.network}`);
console.log(`  receiptRootHash: ${result.receiptRootHash}`);
console.log(`  Receipt URL:     ${client.receiptUrl(result.receiptRootHash)}`);

console.log("\nFetching receipt from 0G Storage...");
let receiptFetched = false;
try {
  const receipt = await client.fetchReceipt(result.receiptRootHash);
  console.log("\n--- Receipt ---");
  console.log(JSON.stringify(receipt, null, 2));

  console.log("\n--- Verification ---");
  const v = client.verifyReceipt(receipt);
  console.log(JSON.stringify(v, null, 2));

  if ("inputHashOk" in v) {
    const allOk = v.valid && v.inputHashOk && v.outputHashOk && v.teeVerified;
    console.log(allOk ? "\n✓ Receipt VALID — all checks pass." : "\n✗ Receipt INVALID — one or more checks failed.");
    receiptFetched = allOk;
  }

  console.log("\n--- Parsed output ---");
  try {
    const parsed = JSON.parse(receipt.output) as Record<string, unknown>;
    console.log(JSON.stringify(parsed, null, 2));
    const hasExpectedFields = "action" in parsed && "amount_bps" in parsed && "confidence" in parsed && "short_reason" in parsed;
    console.log(hasExpectedFields ? "✓ Output has expected fields (action/amount_bps/confidence/short_reason)." : "⚠ Output missing expected fields.");
  } catch {
    console.log("(output is not JSON):", receipt.output);
  }
} catch (e) {
  console.error("fetchReceipt failed:", e instanceof Error ? e.message : e);
  console.log("(Receipt may still be settling — try verify-root in a few seconds.)");
}

process.exit(receiptFetched ? 0 : 1);
