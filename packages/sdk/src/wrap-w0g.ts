// One-shot W0G wrap script — run in Render Shell where SKILLMINT_CALLER_PRIVATE_KEY is set.
// Usage: pnpm skillmint:wrap-w0g [amountOG]
// Default: wraps 0.1 native 0G → W0G on the SkillMint-required contract.

import "dotenv/config";
import { ethers } from "ethers";

const W0G_CONTRACT = "0x7f73A890F0F608Fa32e1dd29a5F552bC7dDa0e01";
const RPC_URL = "https://evmrpc.0g.ai";

const W0G_ABI = [
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const key = process.env.SKILLMINT_CALLER_PRIVATE_KEY;
  if (!key) {
    console.error("SKILLMINT_CALLER_PRIVATE_KEY not set");
    process.exit(1);
  }

  const amountOG = process.argv[2] ? parseFloat(process.argv[2]) : 0.1;
  if (isNaN(amountOG) || amountOG <= 0) {
    console.error("Invalid amount. Usage: pnpm skillmint:wrap-w0g [amountOG]");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(key, provider);
  const w0g = new ethers.Contract(W0G_CONTRACT, W0G_ABI, wallet);

  const nativeBefore = await provider.getBalance(wallet.address);
  const w0gBefore = await w0g.balanceOf(wallet.address) as bigint;

  console.log(`Wallet:       ${wallet.address}`);
  console.log(`Native 0G:    ${ethers.formatEther(nativeBefore)} OG`);
  console.log(`W0G before:   ${ethers.formatEther(w0gBefore)} W0G`);
  console.log(`Wrapping:     ${amountOG} OG → W0G`);

  const value = ethers.parseEther(amountOG.toString());
  if (value >= nativeBefore) {
    console.error(`Insufficient native 0G balance (have ${ethers.formatEther(nativeBefore)}, need ${amountOG})`);
    process.exit(1);
  }

  const tx = await w0g.deposit({ value });
  console.log(`Tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt?.blockNumber}`);

  const w0gAfter = await w0g.balanceOf(wallet.address) as bigint;
  const nativeAfter = await provider.getBalance(wallet.address);
  console.log(`W0G after:    ${ethers.formatEther(w0gAfter)} W0G`);
  console.log(`Native 0G:    ${ethers.formatEther(nativeAfter)} OG (remaining)`);
}

main().catch((err) => {
  console.error("[wrap-w0g] failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
