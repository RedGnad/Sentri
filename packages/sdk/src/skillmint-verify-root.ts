// One-shot CLI: fetch and verify a SkillMint receipt by rootHash.
//
// Usage:
//   pnpm --filter @steward/sdk skillmint:verify-root <rootHash>
//
// Uses SKILLMINT_NETWORK env (default: mainnet = Aristotle 16661).
// No SKILLMINT_CALLER_PRIVATE_KEY needed — fetchReceipt is read-only.

import "dotenv/config";
import { verifySkillMintReceipt } from "./skillmint.js";
import { MAINNET, TESTNET, SkillMintClient } from "@skillmint/sdk";

const rootHash = process.argv[2];
if (!rootHash || !rootHash.startsWith("0x")) {
  console.error("Usage: skillmint:verify-root <0x...rootHash>");
  process.exit(1);
}

const networkName = process.env.SKILLMINT_NETWORK === "testnet" ? "testnet" : "mainnet";
const network = networkName === "testnet" ? TESTNET : MAINNET;
const client = new SkillMintClient({ privateKey: "0x" + "1".repeat(64), network });

console.log(`Network:    ${networkName} (chainId ${network.chainId})`);
console.log(`StorageScan: ${network.storageScan}`);
console.log(`Receipt URL: ${client.receiptUrl(rootHash)}`);
console.log("Fetching...\n");

const result = await verifySkillMintReceipt(rootHash, { network: networkName });
console.log("--- Receipt raw (if fetched) ---");
try {
  const receipt = await client.fetchReceipt(rootHash);
  console.log(JSON.stringify(receipt, null, 2));
} catch(e) {
  console.log("(fetchReceipt failed — see error below)");
}

console.log("\n--- Verification result ---");
console.log(JSON.stringify(result, null, 2));

const ok = result.valid && result.inputHashOk && result.outputHashOk && result.teeVerified;
console.log(ok ? "\n✓ PASS — receipt is valid and TEE-verified." : "\n✗ FAIL — receipt did not pass all checks.");
process.exit(ok ? 0 : 1);
