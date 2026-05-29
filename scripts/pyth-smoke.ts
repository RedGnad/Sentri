#!/usr/bin/env tsx
/**
 * pnpm oracle:pyth-smoke   (run with: node --env-file=.env.local --import tsx scripts/pyth-smoke.ts)
 *
 * Part 1 hard-stop check: verify the Pyth pull oracle is operational on
 * 0G MAINNET before integrating it into the V2 trustless-oracle vault.
 *
 * Outcome:
 *   EXIT 0  — Pyth works on 0G mainnet; safe to integrate.
 *   EXIT 1  — Pyth not reachable / update failed; DO NOT integrate until resolved.
 *
 * ── Addresses (verified on-chain 2026-05-29) ────────────────────────────────
 *
 * 0G Labs has an official Pyth partnership: 2000+ feeds live on 0G mainnet.
 * The OLD canonical EVM address (0x4305…) is EMPTY on 0G (testnet and mainnet) —
 * the earlier version of this script targeted it on testnet and would hard-stop
 * with a false negative. The correct deployment is:
 *
 *   Pyth contract (0G mainnet, chain 16661): 0x2880aB155794e7179c9eE2e38200202908C17B43
 *     (bytecode present, getValidTimePeriod()=60 — confirmed live)
 *   Source: https://docs.pyth.network/price-feeds/contract-addresses/evm
 *
 * ── Feed ID ──────────────────────────────────────────────────────────────────
 *
 * Crypto.0G/USD: 0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070
 *   This is the correct feed for the vault's risk asset (W0G = wrapped 0G),
 *   replacing the previous ETH/USD proxy. Verified live on Hermes (~$0.425,
 *   ~27 bps confidence, fresh), consistent with the keeper SentriPriceFeed.
 */

import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

// ── 0G mainnet chain definition ──────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "https://evmrpc.0g.ai";
const EXPLORER = "https://chainscan.0g.ai";

const og0GMainnet = defineChain({
  id: 16661,
  name: "0G Mainnet",
  nativeCurrency: { name: "0G", symbol: "OG", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "ChainScan", url: EXPLORER } },
});

// ── Constants (verified on-chain) ─────────────────────────────────────────────

// Pyth pull-oracle contract on 0G mainnet.
const PYTH_ADDRESS = "0x2880aB155794e7179c9eE2e38200202908C17B43";

// Crypto.0G/USD feed — matches the vault's W0G risk asset.
const FEED_ID_0G_USD =
  "0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070";

const HERMES_URL = "https://hermes.pyth.network";

// pythMaxConfBps the vault will enforce — used here only to flag a wide spread.
const PYTH_MAX_CONF_BPS = 200;

// Minimal Pyth ABI.
const PYTH_ABI = [
  {
    name: "getUpdateFee",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [{ name: "feeAmount", type: "uint256" }],
  },
  {
    name: "updatePriceFeeds",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "updateData", type: "bytes[]" }],
    outputs: [],
  },
  {
    name: "getPriceNoOlderThan",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "age", type: "uint256" },
    ],
    outputs: [
      {
        name: "price",
        type: "tuple",
        components: [
          { name: "price", type: "int64" },
          { name: "conf", type: "uint64" },
          { name: "expo", type: "int32" },
          { name: "publishTime", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const og = (wei: bigint) => `${wei} wei (${formatUnits(wei, 18)} OG)`;

async function main() {
  console.log("=== Sentri Pyth Smoke Test — 0G MAINNET (chain 16661) ===\n");
  console.log(`RPC          : ${RPC_URL}`);
  console.log(`Pyth contract: ${PYTH_ADDRESS}`);
  console.log(`Feed (0G/USD): ${FEED_ID_0G_USD}\n`);

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY env var required (put it in .env.local and run with --env-file=.env.local)");
    process.exit(1);
  }

  const account = privateKeyToAccount(`0x${privateKey.replace(/^0x/, "")}`);
  const publicClient = createPublicClient({ chain: og0GMainnet, transport: http() });
  const walletClient = createWalletClient({ chain: og0GMainnet, transport: http(), account });

  console.log(`Canary wallet: ${account.address}`);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance      : ${og(balance)}\n`);

  // ── Step 1: Pyth contract presence ──────────────────────────────────────
  console.log(`[1/6] Checking Pyth bytecode at ${PYTH_ADDRESS}...`);
  const bytecode = await publicClient.getBytecode({ address: PYTH_ADDRESS as `0x${string}` });
  if (!bytecode || bytecode === "0x") {
    console.error(`\n❌ HARD STOP: no Pyth contract at ${PYTH_ADDRESS} on 0G mainnet. Do not integrate.`);
    process.exit(1);
  }
  console.log(`   ✓ Bytecode found (${bytecode.length / 2 - 1} bytes)`);

  // ── Step 2: Fetch updateData from Hermes ────────────────────────────────
  console.log(`\n[2/6] Fetching 0G/USD updateData from Hermes...`);
  let updateData: string[];
  try {
    const res = await fetch(`${HERMES_URL}/v2/updates/price/latest?ids[]=${FEED_ID_0G_USD}`);
    if (!res.ok) throw new Error(`Hermes HTTP ${res.status}`);
    const json = (await res.json()) as {
      binary: { data: string[] };
      parsed: Array<{ price: { price: string; conf: string; expo: number; publish_time: number } }>;
    };
    updateData = json.binary.data;
    const p = json.parsed?.[0]?.price;
    if (p) {
      const norm = Number(p.price) * Math.pow(10, p.expo);
      console.log(`   ✓ Hermes 0G/USD: $${norm.toFixed(5)} | conf ${Math.round(Number(p.conf) / Number(p.price) * 10_000)} bps | published ${new Date(p.publish_time * 1000).toISOString()}`);
    }
  } catch (err) {
    console.error("   ✗ Hermes fetch failed:", err);
    process.exit(1);
  }
  const updateDataBytes = updateData.map((d) => `0x${d}` as `0x${string}`);

  // ── Step 3: getUpdateFee + cost preflight ───────────────────────────────
  console.log(`\n[3/6] getUpdateFee + gas/balance preflight...`);
  let fee: bigint;
  try {
    fee = await publicClient.readContract({
      address: PYTH_ADDRESS as `0x${string}`,
      abi: PYTH_ABI,
      functionName: "getUpdateFee",
      args: [updateDataBytes],
    });
  } catch (err) {
    console.error("   ✗ getUpdateFee failed (not an IPyth contract?):", err);
    process.exit(1);
  }
  const gasEstimate = await publicClient.estimateContractGas({
    address: PYTH_ADDRESS as `0x${string}`,
    abi: PYTH_ABI,
    functionName: "updatePriceFeeds",
    args: [updateDataBytes],
    value: fee,
    account,
  });
  const gasPrice = await publicClient.getGasPrice();
  const estGasCost = gasEstimate * gasPrice;
  const estTotal = fee + estGasCost;
  console.log(`   Pyth update fee : ${og(fee)}`);
  console.log(`   est. gas        : ${gasEstimate} @ ${gasPrice} wei/gas → ${og(estGasCost)}`);
  console.log(`   est. total cost : ${og(estTotal)}`);
  if (balance <= estTotal) {
    console.error(`\n❌ HARD STOP: balance ${og(balance)} < est. total ${og(estTotal)}. Fund the canary wallet. No tx sent.`);
    process.exit(1);
  }
  console.log(`   ✓ Balance covers fee + gas`);

  // ── Step 4: updatePriceFeeds (the only on-chain write) ──────────────────
  console.log(`\n[4/6] Broadcasting updatePriceFeeds (value=${fee} wei)...`);
  let gasUsed: bigint;
  let effGasPrice: bigint;
  let txHash: `0x${string}`;
  try {
    txHash = await walletClient.writeContract({
      address: PYTH_ADDRESS as `0x${string}`,
      abi: PYTH_ABI,
      functionName: "updatePriceFeeds",
      args: [updateDataBytes],
      value: fee,
    });
    console.log(`   tx: ${EXPLORER}/tx/${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error(`tx reverted (status=${receipt.status})`);
    gasUsed = receipt.gasUsed;
    effGasPrice = receipt.effectiveGasPrice;
    console.log(`   ✓ updatePriceFeeds SUCCESS — block ${receipt.blockNumber}, gasUsed ${gasUsed}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/InsufficientFee/i.test(msg)) console.error("   ✗ InsufficientFee — value sent was below getUpdateFee.");
    console.error("   ✗ updatePriceFeeds failed:", msg);
    process.exit(1);
  }

  // ── Step 5: getPriceNoOlderThan (StalePrice check) ──────────────────────
  console.log(`\n[5/6] getPriceNoOlderThan(0G/USD, maxAge=60s)...`);
  try {
    const r = (await publicClient.readContract({
      address: PYTH_ADDRESS as `0x${string}`,
      abi: PYTH_ABI,
      functionName: "getPriceNoOlderThan",
      args: [FEED_ID_0G_USD as `0x${string}`, 60n],
    })) as { price: bigint; conf: bigint; expo: number; publishTime: bigint };
    const norm = Number(r.price) * Math.pow(10, r.expo);
    const confBps = Math.round(Number(r.conf) / Number(r.price) * 10_000);
    console.log(`   ✓ getPriceNoOlderThan SUCCESS (no StalePrice):`);
    console.log(`     price       : ${r.price} (normalized $${norm.toFixed(5)})`);
    console.log(`     conf        : ${r.conf} (${confBps} bps)`);
    console.log(`     expo        : ${r.expo}`);
    console.log(`     publishTime : ${r.publishTime} (${new Date(Number(r.publishTime) * 1000).toISOString()})`);
    if (confBps > PYTH_MAX_CONF_BPS) {
      console.warn(`     ⚠ confidence ${confBps} bps exceeds pythMaxConfBps=${PYTH_MAX_CONF_BPS} — the vault would reject this update.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/StalePrice|0OlderThan|getPriceNoOlderThan/i.test(msg)) console.error("   ✗ StalePrice — price older than 60s after update.");
    console.error("   ✗ getPriceNoOlderThan failed:", msg);
    process.exit(1);
  }

  // ── Step 6: Cost + config summary ───────────────────────────────────────
  const actualGasCost = gasUsed * effGasPrice;
  console.log(`\n[6/6] Actual cost:`);
  console.log(`   Pyth update fee : ${og(fee)}`);
  console.log(`   gas             : ${gasUsed} @ ${effGasPrice} wei/gas → ${og(actualGasCost)}`);
  console.log(`   TOTAL spent     : ${og(fee + actualGasCost)}`);

  console.log(`\n=== ✅ SMOKE TEST PASSED — Pyth pull oracle operational on 0G mainnet ===`);
  console.log(`\nV2 deployment config:`);
  console.log(`  PYTH_CONTRACT_ADDRESS=${PYTH_ADDRESS}`);
  console.log(`  PYTH_PRICE_ID=${FEED_ID_0G_USD}   # Crypto.0G/USD`);
  console.log(`  pythMaxAge=60`);
  console.log(`  pythMaxConfBps=${PYTH_MAX_CONF_BPS}`);
}

main().catch((err) => {
  console.error("\n💥 Unhandled error:", err);
  process.exit(1);
});
