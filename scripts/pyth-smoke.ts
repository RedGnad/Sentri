#!/usr/bin/env tsx
/**
 * pnpm oracle:pyth-smoke
 *
 * Part 1 hard-stop check: verify that the Pyth pull oracle is operational
 * on 0G chain before integrating it into the vault.
 *
 * Outcome:
 *   EXIT 0  — Pyth works on 0G; safe to integrate.
 *   EXIT 1  — Pyth not reachable on 0G; DO NOT integrate until resolved.
 *
 * ── Address research ────────────────────────────────────────────────────────
 *
 * 0G Galileo testnet (chain ID 16602) is a relatively new EVM chain.
 * Pyth's canonical EVM contract address on many chains is:
 *   0x4305FB66699C3B2702D4d05CF36551390A4c69C3
 *
 * However, 0G is NOT in the official Pyth supported chain list as of May 2026.
 * The script will:
 *   1. Probe the known canonical address for Pyth bytecode.
 *   2. If no bytecode → report blocker, exit 1.
 *   3. If bytecode found → attempt getUpdateFee + updatePriceFeeds + read.
 *
 * ── Feed ID ──────────────────────────────────────────────────────────────────
 *
 * W0G/USD: No Pyth price ID found as of this writing.
 *   Reason: W0G is a wrapped version of 0G's native token. Pyth publishers
 *   typically add feeds for tokens with sufficient trading volume and price
 *   provider support. W0G has no confirmed Pyth feed.
 *
 * Fallback: ETH/USD
 *   Feed ID: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace
 *   This is appropriate for our vault which trades MockWETH (ETH-like) vs MockUSDC.
 *   Assumption: MockWETH represents a $ETH-like risk asset; ETH/USD is the
 *   correct oracle for slippage and policy enforcement.
 */

import { createPublicClient, createWalletClient, http, parseEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

// ── 0G Chain definition ──────────────────────────────────────────────────────

const og0GChain = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "OG", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://evmrpc-testnet.0g.ai"] },
  },
  blockExplorers: {
    default: { name: "ChainScan", url: "https://chainscan-galileo.0g.ai" },
  },
});

// ── Constants ────────────────────────────────────────────────────────────────

// Pyth canonical address on many EVM chains. MUST be verified for 0G.
// Source: https://docs.pyth.network/price-feeds/contract-addresses/evm
const PYTH_CANDIDATE_ADDRESS = "0x4305FB66699C3B2702D4d05CF36551390A4c69C3";

// ETH/USD feed (fallback; W0G/USD not available)
const ETH_USD_FEED_ID =
  "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

// Hermes REST endpoint for price updates
const HERMES_URL = "https://hermes.pyth.network";

// Minimal Pyth ABI
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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Sentri Pyth Smoke Test — 0G Galileo ===\n");

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY env var required");
    process.exit(1);
  }

  const account = privateKeyToAccount(`0x${privateKey.replace("0x", "")}`);
  const publicClient = createPublicClient({
    chain: og0GChain,
    transport: http(),
  });
  const walletClient = createWalletClient({
    chain: og0GChain,
    transport: http(),
    account,
  });

  // ── Step 1: Check Pyth contract presence ────────────────────────────────

  console.log(`[1/7] Checking Pyth bytecode at ${PYTH_CANDIDATE_ADDRESS}...`);
  const bytecode = await publicClient.getBytecode({ address: PYTH_CANDIDATE_ADDRESS as `0x${string}` });

  if (!bytecode || bytecode === "0x") {
    console.error("\n❌ HARD STOP: No Pyth contract found at", PYTH_CANDIDATE_ADDRESS, "on 0G Galileo.");
    console.error("\nBlocker details:");
    console.error("  - 0G Galileo (chain ID 16602) is not yet in the official Pyth EVM deployment list.");
    console.error("  - The Pyth canonical address may differ or Pyth may not be deployed on this chain.");
    console.error("\nAction required before Trustless Oracle integration:");
    console.error("  1. Check https://docs.pyth.network/price-feeds/contract-addresses/evm for 0G.");
    console.error("  2. Contact Pyth / 0G team to confirm deployment or request deployment.");
    console.error("  3. Re-run this smoke test with the confirmed address.");
    console.error("\nCurrent Sentri standard vault (SentriPriceFeed) is unaffected and stable.");
    process.exit(1);
  }

  console.log(`   ✓ Bytecode found (${bytecode.length / 2 - 1} bytes)`);

  // ── Step 2: Fetch updateData from Hermes ────────────────────────────────

  console.log(`\n[2/7] Fetching updateData from Hermes for feed ${ETH_USD_FEED_ID.slice(0, 10)}...`);
  let updateData: string[];
  try {
    const hermesRes = await fetch(
      `${HERMES_URL}/v2/updates/price/latest?ids[]=${ETH_USD_FEED_ID}`
    );
    if (!hermesRes.ok) throw new Error(`Hermes HTTP ${hermesRes.status}`);
    const hermesJson = await hermesRes.json() as {
      binary: { data: string[] };
      parsed: Array<{
        id: string;
        price: { price: string; conf: string; expo: number; publish_time: number };
      }>;
    };
    updateData = hermesJson.binary.data;
    const parsed = hermesJson.parsed?.[0];
    if (parsed) {
      const { price: p } = parsed;
      const norm = Number(p.price) * Math.pow(10, p.expo);
      console.log(`   ✓ Hermes response:`);
      console.log(`     raw price   : ${p.price}`);
      console.log(`     expo        : ${p.expo}`);
      console.log(`     conf        : ${p.conf}`);
      console.log(`     publishTime : ${p.publish_time} (${new Date(p.publish_time * 1000).toISOString()})`);
      console.log(`     normalized  : $${norm.toFixed(2)}`);
      console.log(`     confBps     : ${Math.round(Number(p.conf) / Number(p.price) * 10_000)} bps`);
    }
  } catch (err) {
    console.error("   ✗ Failed to fetch from Hermes:", err);
    process.exit(1);
  }

  const updateDataBytes = updateData.map((d) => `0x${d}` as `0x${string}`);

  // ── Step 3: getUpdateFee ─────────────────────────────────────────────────

  console.log(`\n[3/7] Calling getUpdateFee...`);
  let fee: bigint;
  try {
    fee = await publicClient.readContract({
      address: PYTH_CANDIDATE_ADDRESS as `0x${string}`,
      abi: PYTH_ABI,
      functionName: "getUpdateFee",
      args: [updateDataBytes],
    });
    console.log(`   ✓ Update fee: ${fee} wei (${formatUnits(fee, 18)} OG)`);
  } catch (err) {
    console.error("   ✗ getUpdateFee failed:", err);
    console.error("   → Contract at address may not implement IPyth interface.");
    process.exit(1);
  }

  // ── Step 4: Submit updatePriceFeeds ─────────────────────────────────────

  console.log(`\n[4/7] Calling updatePriceFeeds (fee=${fee} wei)...`);
  let txHash: string;
  try {
    txHash = await walletClient.writeContract({
      address: PYTH_CANDIDATE_ADDRESS as `0x${string}`,
      abi: PYTH_ABI,
      functionName: "updatePriceFeeds",
      args: [updateDataBytes],
      value: fee,
    });
    console.log(`   ✓ Tx submitted: ${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
    console.log(`   ✓ Confirmed in block ${receipt.blockNumber}, gas used: ${receipt.gasUsed}`);
  } catch (err) {
    console.error("   ✗ updatePriceFeeds failed:", err);
    process.exit(1);
  }

  // ── Step 5: getPriceNoOlderThan ──────────────────────────────────────────

  console.log(`\n[5/7] Calling getPriceNoOlderThan (maxAge=60s)...`);
  let priceResult: { price: bigint; conf: bigint; expo: number; publishTime: bigint };
  try {
    priceResult = await publicClient.readContract({
      address: PYTH_CANDIDATE_ADDRESS as `0x${string}`,
      abi: PYTH_ABI,
      functionName: "getPriceNoOlderThan",
      args: [`0x${ETH_USD_FEED_ID.replace("0x", "")}`, 60n],
    }) as typeof priceResult;

    const { price, conf, expo, publishTime } = priceResult;
    const norm = Number(price) * Math.pow(10, expo);
    const confBps = Math.round(Number(conf) / Number(price) * 10_000);

    console.log(`\n   ✓ Pyth price verified on-chain:`);
    console.log(`     raw price   : ${price}`);
    console.log(`     expo        : ${expo}`);
    console.log(`     conf        : ${conf}`);
    console.log(`     publishTime : ${publishTime} (${new Date(Number(publishTime) * 1000).toISOString()})`);
    console.log(`     normalized  : $${norm.toFixed(2)}`);
    console.log(`     confBps     : ${confBps} bps`);
    console.log(`     tx hash     : ${txHash}`);
  } catch (err) {
    console.error("   ✗ getPriceNoOlderThan failed:", err);
    process.exit(1);
  }

  // ── Step 6: Summary ──────────────────────────────────────────────────────

  console.log(`\n=== ✅ SMOKE TEST PASSED ===`);
  console.log(`\nPyth pull oracle is operational on 0G Galileo.`);
  console.log(`Safe to integrate TrustlessOracleVault.\n`);
  console.log(`Configuration for deployment:`);
  console.log(`  PYTH_CONTRACT_ADDRESS=${PYTH_CANDIDATE_ADDRESS}`);
  console.log(`  PYTH_PRICE_ID=${ETH_USD_FEED_ID}`);
  console.log(`  pythMaxAge=60`);
  console.log(`  pythMaxConfBps=200 (2%)`);
  console.log(`\nNote: ETH/USD feed used (W0G/USD not available on Pyth as of May 2026).`);
  console.log(`      This is appropriate for MockWETH risk asset; matches SentriPriceFeed convention.`);
}

main().catch((err) => {
  console.error("\n💥 Unhandled error:", err);
  process.exit(1);
});
