import { ethers } from "ethers";
import "dotenv/config";
import { createRequire } from "node:module";
import { CHAIN } from "./constants.js";

// 0.7.4 ESM build is broken — use CJS entrypoint directly.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require(
  "@0glabs/0g-serving-broker",
) as typeof import("@0glabs/0g-serving-broker");

// 0G Compute Network contract addresses on Galileo testnet (chain 16602).
// Broker 2.0.0 hardcodes obsolete defaults — pass these explicitly.
const LEDGER_CA = "0xE70830508dAc0A97e6c087c75f402f9Be669E406";
const INFERENCE_CA = "0xa79F4c8311FF93C06b8CfB403690cc987c93F91E";
const FINE_TUNING_CA = "0xC6C075D8039763C8f1EbE580be5ADdf2fd6941bA";

const DEPOSIT_AMOUNT = 3; // OG (broker minimum to create a ledger)

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("Missing PRIVATE_KEY in .env");

  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Wallet: ${wallet.address}`);

  // Check OG balance
  const ogBalance = await provider.getBalance(wallet.address);
  console.log(`OG balance: ${ethers.formatEther(ogBalance)} OG`);

  if (ogBalance < ethers.parseEther("3.05")) {
    console.error("Insufficient OG balance. Get more from the faucet first.");
    process.exit(1);
  }

  console.log("\nInitializing 0G Compute broker...");
  const broker = await createZGComputeNetworkBroker(
    wallet,
    LEDGER_CA,
    INFERENCE_CA,
    FINE_TUNING_CA,
  );

  // Check current ledger balance
  console.log("Checking ledger...");
  try {
    const ledger = await broker.ledger.getLedger();
    console.log("Ledger:", ledger);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`No ledger yet (${msg})`);
    console.log(`\nCreating ledger with ${DEPOSIT_AMOUNT} OG...`);
    await broker.ledger.addLedger(DEPOSIT_AMOUNT);
    console.log("Ledger created.");
  }

  // List available services
  console.log("\nAvailable inference services:");
  const services = await broker.inference.listService();
  for (const s of services) {
    console.log(`  - ${s.provider} | ${s.serviceType} | ${s.url ?? ""}`);
  }
  if (services.length === 0) {
    console.log("  (none)");
  }

  console.log("\nSetup done.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
