// One-shot admin script — rotate the AgentINFT TEE signer binding.
// Run from the Render shell (where PRIVATE_KEY is the agent/owner wallet).
//
// Usage:
//   pnpm rotate-agent-signer [newSigner]
//
// If newSigner is omitted, the script reads the current 0G Compute provider
// signer from the on-chain agent metadata and uses that as the new value.
// Explicit override:
//   NEW_TEE_SIGNER=0x0038… pnpm rotate-agent-signer
//   pnpm rotate-agent-signer 0x0038F716958A90b753DA6937787395E2365DB2e8

import "dotenv/config";
import { ethers } from "ethers";
import { CHAIN, CONTRACTS, AGENT_INFT_ABI } from "./constants.js";

const ROTATE_SIGNER_ABI = [
  ...AGENT_INFT_ABI,
  "function rotateSigner(uint256 tokenId, address newSigner) external",
  "function owner() view returns (address)",
];

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.error("PRIVATE_KEY not set (must be the AgentINFT owner wallet)");
    process.exit(1);
  }

  const newSigner: string | undefined =
    process.argv[2]?.trim() || process.env.NEW_TEE_SIGNER?.trim();

  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);

  const agentINFT = new ethers.Contract(CONTRACTS.agentINFT, ROTATE_SIGNER_ABI, wallet);

  const owner: string = await agentINFT.owner();
  console.log("AgentINFT:       ", CONTRACTS.agentINFT);
  console.log("AgentINFT owner: ", owner);
  console.log("Caller wallet:   ", wallet.address);

  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(
      `ERROR: caller ${wallet.address} is not the AgentINFT owner (${owner}). ` +
        "Use the owner wallet's PRIVATE_KEY.",
    );
    process.exit(1);
  }

  // Read current state
  const meta = await agentINFT.agentMetadata(0n);
  const currentSigner: string = meta.teeSignerAddress;
  console.log("\nToken #0 current TEE signer:", currentSigner);

  if (!newSigner) {
    console.error(
      "No new signer provided. Pass as CLI arg or set NEW_TEE_SIGNER.\n" +
        "Example: pnpm rotate-agent-signer 0x0038F716958A90b753DA6937787395E2365DB2e8",
    );
    process.exit(1);
  }

  if (!ethers.isAddress(newSigner)) {
    console.error("Invalid address:", newSigner);
    process.exit(1);
  }

  if (newSigner.toLowerCase() === currentSigner.toLowerCase()) {
    console.log("New signer equals current signer — nothing to do.");
    process.exit(0);
  }

  console.log(`\nRotating TEE signer:\n  from: ${currentSigner}\n  to:   ${newSigner}`);
  console.log("Sending rotateSigner(0, newSigner)...");

  const tx = await agentINFT.rotateSigner(0n, newSigner);
  console.log("Tx submitted:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt?.blockNumber);

  // Verify
  const metaAfter = await agentINFT.agentMetadata(0n);
  const signerAfter: string = metaAfter.teeSignerAddress;
  console.log("\nVerification — token #0 TEE signer after:", signerAfter);

  if (signerAfter.toLowerCase() === newSigner.toLowerCase()) {
    console.log("✓ Signer rotation confirmed on-chain. Agent will self-heal on next cycle.");
  } else {
    console.error("✗ Rotation not reflected on-chain — check tx status.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[rotate-agent-signer] failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
