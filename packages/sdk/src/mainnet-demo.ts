import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../../../contracts/.env"), override: false });

process.env.SENTRI_NETWORK ??= "mainnet";
process.env.NEXT_PUBLIC_SENTRI_NETWORK ??= "mainnet";
process.env.MARKET_ASSET ??= "W0G";
process.env.SENTRI_BASE_SYMBOL ??= "USDC.E";
process.env.SENTRI_RISK_SYMBOL ??= "W0G";
process.env.NEXT_PUBLIC_BASE_SYMBOL ??= "USDC.E";
process.env.NEXT_PUBLIC_RISK_SYMBOL ??= "W0G";
if (process.env.PRIVATE_KEY_MAINNET) {
  process.env.PRIVATE_KEY = process.env.PRIVATE_KEY_MAINNET;
}

const { ethers } = await import("ethers");
const {
  CHAIN,
  CONTRACTS,
  TREASURY_VAULT_ABI,
  ERC20_ABI,
} = await import("./constants.js");
const { getMarketSnapshot } = await import("./market.js");
const {
  setupGlobalContext,
  pushPrice,
  executeOneIterationForVault,
} = await import("./agent.js");

const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require(
  "@0glabs/0g-serving-broker",
) as typeof import("@0glabs/0g-serving-broker");

const W0G_ABI = [
  ...ERC20_ABI,
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function deposit() payable",
  "function withdraw(uint256 wad)",
] as const;

function usage(): never {
  console.log(`Usage:
  pnpm --filter @steward/sdk run mainnet:demo -- status
  pnpm --filter @steward/sdk run mainnet:demo -- wrap <amount_0g>
  pnpm --filter @steward/sdk run mainnet:demo -- seed-risk <amount_w0g>
  pnpm --filter @steward/sdk run mainnet:demo -- stress <amount_w0g>
  pnpm --filter @steward/sdk run mainnet:demo -- setup-compute <amount_0g>
  pnpm --filter @steward/sdk run mainnet:demo -- run-once

Recommended recording path:
  1. status
  2. stress 0.05      # wraps missing W0G, then transfers W0G to the demo vault
  3. setup-compute 3  # 0G Compute requires at least 3 OG to create a ledger
  4. run-once         # pushes W0G price, requests 0G Sealed Inference, executes via Jaine
`);
  process.exit(1);
}

function privateKey(): string {
  const key = process.env.PRIVATE_KEY;
  if (!key) throw new Error("Missing PRIVATE_KEY or PRIVATE_KEY_MAINNET for this command");
  return key.startsWith("0x") ? key : `0x${key}`;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const [cmd, amountArg] = args;
  if (!cmd) usage();

  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  const maybeKey = process.env.PRIVATE_KEY ? privateKey() : null;
  const signer = maybeKey ? new ethers.Wallet(maybeKey, provider) : null;
  const configuredAddress = signer?.address ?? process.env.AGENT_ADDRESS_MAINNET ?? process.env.AGENT_ADDRESS;
  if (!configuredAddress) throw new Error("Set PRIVATE_KEY_MAINNET or AGENT_ADDRESS_MAINNET");
  const walletAddress: string = configuredAddress;

  const vault = new ethers.Contract(CONTRACTS.demoVault, TREASURY_VAULT_ABI, signer ?? provider);
  const baseAddr: string = await vault.base();
  const riskAddr: string = await vault.risk();
  const base = new ethers.Contract(baseAddr, ERC20_ABI, signer ?? provider);
  const risk = new ethers.Contract(riskAddr, W0G_ABI, signer ?? provider);
  const [baseDec, riskDec] = await Promise.all([base.decimals(), risk.decimals()]);

  async function printStatus() {
    const market = await getMarketSnapshot();
    const [
      nativeBal,
      walletBase,
      walletRisk,
      vaultBase,
      vaultRisk,
      tvl,
      hwm,
      logs,
      owner,
      agent,
    ] = await Promise.all([
      provider.getBalance(walletAddress),
      base.balanceOf(walletAddress),
      risk.balanceOf(walletAddress),
      vault.vaultBalance(),
      vault.riskBalance(),
      vault.totalValue().catch(() => 0n),
      vault.highWaterMark(),
      vault.executionLogCount(),
      vault.owner(),
      vault.agent(),
    ]);
    console.log(JSON.stringify({
      network: CHAIN.name,
      chainId: CHAIN.id,
      wallet: walletAddress,
      nativeOG: ethers.formatEther(nativeBal),
      walletBase: `${ethers.formatUnits(walletBase, baseDec)} USDC.E`,
      walletRisk: `${ethers.formatUnits(walletRisk, riskDec)} W0G`,
      vault: CONTRACTS.demoVault,
      vaultBase: `${ethers.formatUnits(vaultBase, baseDec)} USDC.E`,
      vaultRisk: `${ethers.formatUnits(vaultRisk, riskDec)} W0G`,
      vaultTVL: typeof tvl === "bigint" ? `${ethers.formatUnits(tvl, baseDec)} USDC.E` : "unavailable",
      highWaterMark: `${ethers.formatUnits(hwm, baseDec)} USDC.E`,
      executionLogs: logs.toString(),
      owner,
      agent,
      market,
    }, null, 2));
  }

  async function wrap(amount: bigint) {
    if (!signer) throw new Error("Wrapping requires PRIVATE_KEY_MAINNET");
    const tx = await risk.deposit({ value: amount });
    console.log(`wrap tx: ${tx.hash}`);
    await tx.wait();
  }

  async function seedRisk(amount: bigint) {
    if (!signer) throw new Error("Seeding requires PRIVATE_KEY_MAINNET");
    const tx = await risk.transfer(CONTRACTS.demoVault, amount);
    console.log(`seed-risk tx: ${tx.hash}`);
    await tx.wait();
  }

  if (cmd === "status") {
    await printStatus();
    return;
  }

  if (cmd === "run-once") {
    const ctx = await setupGlobalContext();
    const market = await pushPrice(ctx);
    const outcome = await executeOneIterationForVault(ctx, CONTRACTS.demoVault, market);
    console.log(JSON.stringify(outcome, null, 2));
    return;
  }

  if (cmd === "setup-compute") {
    if (!signer) throw new Error("Compute setup requires PRIVATE_KEY_MAINNET");
    const amount = Number(amountArg ?? "3");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid setup-compute amount");
    if (amount < 3) {
      throw new Error("0G Compute requires at least 3 OG to create a new ledger. Use setup-compute 3.");
    }
    const broker = await createZGComputeNetworkBroker(signer);
    try {
      const ledger = await broker.ledger.getLedger();
      console.log("Existing ledger:", ledger);
      console.log(`Depositing ${amount} OG into compute ledger...`);
      await broker.ledger.depositFund(amount);
      console.log("Compute ledger topped up.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`No compute ledger yet (${msg})`);
      console.log(`Creating compute ledger with ${amount} OG...`);
      await broker.ledger.addLedger(amount);
      console.log("Compute ledger created.");
    }
    return;
  }

  if (!amountArg) usage();
  const amount = ethers.parseUnits(amountArg, riskDec);

  if (cmd === "wrap") {
    await wrap(amount);
    await printStatus();
    return;
  }

  if (cmd === "seed-risk") {
    await seedRisk(amount);
    await printStatus();
    return;
  }

  if (cmd === "stress") {
    if (!signer) throw new Error("Stress setup requires PRIVATE_KEY_MAINNET");
    const currentRisk: bigint = await risk.balanceOf(signer.address);
    if (currentRisk < amount) {
      const missing = amount - currentRisk;
      console.log(`Wrapping missing ${ethers.formatUnits(missing, riskDec)} W0G...`);
      await wrap(missing);
    }
    await seedRisk(amount);
    await printStatus();
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
