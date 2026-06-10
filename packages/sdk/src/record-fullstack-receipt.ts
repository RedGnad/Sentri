// One-shot: record a real full-stack verifiable receipt on 0G mainnet.
// Binds TEE-style signer + 0G Storage reasoning root + verified Pyth price.
// Run: SENTRI_NETWORK=mainnet PRIVATE_KEY_SEND=0x.. npx tsx src/record-fullstack-receipt.ts

import { ethers } from "ethers";
import { initStorage, uploadJsonRecord } from "./storage.js";

const RPC = process.env.RPC_URL ?? "https://evmrpc.0g.ai";
const REGISTRY = process.env.REGISTRY_ADDRESS ?? "0xded9a0E7385663bE530d7d849588aBe693cc4DD1";
const CONSUMER = process.env.CONSUMER_ADDRESS ?? "0x5A4CE05104e5562D340a9db843682654Ce321437";
const PYTH = process.env.PYTH_CONTRACT_ADDRESS ?? "0x2880aB155794e7179c9eE2e38200202908C17B43";
const FEED = process.env.PYTH_PRICE_ID ?? "0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070";
const HERMES = process.env.HERMES_URL ?? "https://hermes.pyth.network";

const KEY_RAW = process.env.PRIVATE_KEY_SEND ?? process.env.PRIVATE_KEY;
if (!KEY_RAW || KEY_RAW === "0x") throw new Error("set PRIVATE_KEY_SEND");
const KEY = KEY_RAW.startsWith("0x") ? KEY_RAW : `0x${KEY_RAW}`;

const CONSUMER_ABI = [
  "function executeFullStack(bytes32 intentHash, string signedResponse, bytes signature, bytes[] pythUpdateData, bytes32 storageRoot) payable returns (uint256 index, uint256 price)",
];
const REGISTRY_ABI = [
  "function receiptCount(address) view returns (uint256)",
  "function receiptAt(address,uint256) view returns (tuple(uint64 timestamp,address signer,bytes32 intentHash,bytes32 responseHash,bytes32 attestation,bytes32 payloadHash))",
];
const PYTH_ABI = ["function getUpdateFee(bytes[]) view returns (uint256)"];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  console.log("signer/owner:", wallet.address);

  // 1. Upload reasoning to 0G Storage Log -> real root (no KV node needed).
  initStorage(KEY);
  const reasoning = {
    agent: "Sentri FullStackAttestedConsumer",
    intent: "full-stack verifiable receipt",
    decision: "HOLD",
    rationale: "receipt binds TEE signer + 0G Storage reasoning + verified Pyth price",
    ts: Date.now(),
  };
  console.log("uploading reasoning to 0G Storage Log...");
  const up = await uploadJsonRecord(reasoning, "sentri:execution:v1");
  if (!up) throw new Error("storage upload returned null");
  const storageRoot = up.rootHash.startsWith("0x") ? up.rootHash : `0x${up.rootHash}`;
  console.log("  storage root:", storageRoot, "(tx", up.txHash + ")");

  // 2. Fetch a fresh Hermes price update for the feed.
  console.log("fetching Hermes price update...");
  const res = await fetch(`${HERMES}/v2/updates/price/latest?ids[]=${FEED}`);
  if (!res.ok) throw new Error(`Hermes HTTP ${res.status}`);
  const json = (await res.json()) as { binary: { data: string[] } };
  const updateData = json.binary.data.map((d) => (d.startsWith("0x") ? d : `0x${d}`));
  console.log("  updateData blobs:", updateData.length);

  // 3. Sign the response (signer == consumer's authorised signer == owner).
  const signedResponse = JSON.stringify({ decision: reasoning.decision, storageRoot, feed: FEED, ts: reasoning.ts });
  const signature = await wallet.signMessage(signedResponse);
  const intentHash = ethers.keccak256(ethers.toUtf8Bytes(`fullstack:${reasoning.ts}`));

  // 4. Pyth fee.
  const pyth = new ethers.Contract(PYTH, PYTH_ABI, provider);
  const fee = (await pyth.getUpdateFee(updateData)) as bigint;
  console.log("  pyth fee (wei):", fee.toString());

  // 5. Record the full-stack receipt on-chain.
  const consumer = new ethers.Contract(CONSUMER, CONSUMER_ABI, wallet);
  console.log("recording full-stack receipt on-chain...");
  const tx = await consumer.executeFullStack(intentHash, signedResponse, signature, updateData, storageRoot, {
    value: fee,
  });
  console.log("  tx:", tx.hash);
  const rcpt = await tx.wait();
  console.log("  mined in block", rcpt?.blockNumber);

  // 6. Read it back from the registry.
  const reg = new ethers.Contract(REGISTRY, REGISTRY_ABI, provider);
  const count = (await reg.receiptCount(CONSUMER)) as bigint;
  const r = await reg.receiptAt(CONSUMER, count - 1n);
  console.log(`\nRECEIPT #${(count - 1n).toString()}`);
  console.log("  signer            :", r.signer);
  console.log("  attestation(root) :", r.attestation);
  console.log("  responseHash      :", r.responseHash);
  console.log("  payloadHash       :", r.payloadHash);
  console.log("  storageRoot bound :", r.attestation.toLowerCase() === storageRoot.toLowerCase());
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
