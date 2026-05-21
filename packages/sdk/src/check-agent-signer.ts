// CLI diagnostic — Sentri agent TEE-signer health check.
//
// Read-only. No private key required. Answers the question:
//   "Is the TEE signer the runner uses bound to the agent's active AgentINFT?"
// A mismatch is exactly what makes TreasuryVault.executeStrategy revert with
// InvalidTEESignature (selector 0x4c0f9589).
//
// Run:
//   pnpm --filter @steward/sdk check-signer
//   RECOVERED_TEE_SIGNER=0x… pnpm --filter @steward/sdk check-signer
//
// Env (all optional — falls back to the factory immutables / src/constants.ts):
//   RPC_URL              0G RPC endpoint
//   FACTORY_ADDRESS      VaultFactory address (or NEXT_PUBLIC_VAULT_FACTORY_ADDRESS)
//   AGENT_INFT_ADDRESS   AgentINFT address   (or NEXT_PUBLIC_AGENT_INFT_ADDRESS)
//   AGENT_ADDRESS        agent wallet        (else read from factory.agent())
//   AGENT_TOKEN_ID       agent INFT token id (else read from factory.agentTokenId())
//   RECOVERED_TEE_SIGNER signer recovered from the latest TEE response (optional)

import "dotenv/config";
import { ethers } from "ethers";
import { DEFAULT_RPC_URL, fetchSignerHealth, resolveAgentIdentity } from "./agent-signer.js";

function envAddr(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL?.trim() || DEFAULT_RPC_URL;
  const recoveredSigner = envAddr("RECOVERED_TEE_SIGNER") ?? null;

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const identity = await resolveAgentIdentity({
    provider,
    factoryAddress: envAddr("FACTORY_ADDRESS", "NEXT_PUBLIC_VAULT_FACTORY_ADDRESS"),
    agentNFTAddress: envAddr("AGENT_INFT_ADDRESS", "NEXT_PUBLIC_AGENT_INFT_ADDRESS"),
    agentAddress: envAddr("AGENT_ADDRESS"),
    agentTokenId: process.env.AGENT_TOKEN_ID?.trim() || undefined,
  });

  const health = await fetchSignerHealth({
    provider,
    agentNFTAddress: identity.agentNFTAddress,
    agentAddress: identity.agentAddress,
    agentTokenId: identity.agentTokenId,
    recoveredSigner,
  });

  console.log("");
  console.log("Sentri — agent TEE-signer health check");
  console.log("──────────────────────────────────────");
  console.log(`RPC:                          ${rpcUrl}`);
  console.log(`VaultFactory:                 ${identity.factoryAddress}`);
  console.log(`AgentINFT:                    ${health.agentNFTAddress}`);
  console.log(`Agent:                        ${health.agentAddress}`);
  console.log(`Agent token id:               ${health.agentTokenId}`);
  console.log(`Holds active AgentINFT:       ${health.isActiveAgent}`);
  console.log(`Expected TEE signer on-chain: ${health.expectedSigner}`);
  console.log(`Provider (on-chain):          ${health.provider}`);
  console.log(`Metadata root hash:           ${health.metadataRootHash}`);
  console.log(`Recovered TEE signer:         ${health.recoveredSigner ?? "(not supplied — set RECOVERED_TEE_SIGNER)"}`);

  if (!health.isActiveAgent) {
    console.log(`Match:                        n/a`);
    console.log(
      "Verdict: AGENT_NOT_ACTIVE — the agent wallet holds no active (non-revoked) AgentINFT. " +
        "Mint/reinstate the AgentINFT with the owner key before executing.",
    );
    process.exitCode = 2;
    return;
  }

  if (!health.recoveredSigner) {
    console.log(`Match:                        unknown (no recovered signer supplied)`);
    console.log(
      "Verdict: INCONCLUSIVE — re-run with RECOVERED_TEE_SIGNER set to the signer recovered " +
        "from the latest TEE response to confirm the binding.",
    );
    return;
  }

  console.log(`Match:                        ${health.match}`);
  if (health.match) {
    console.log("Verdict: OK — recovered signer is bound to the active AgentINFT. executeStrategy will pass _verifyTEE.");
  } else {
    console.log(
      "Verdict: SIGNER_MISMATCH — do not execute. The recovered TEE signer is not bound to the " +
        "active AgentINFT, so executeStrategy reverts with InvalidTEESignature (0x4c0f9589). " +
        "Reconcile the runner/provider config so the 0G provider's TEE signer matches the " +
        "on-chain value, or — only if your AgentINFT exposes rotateSigner — have the owner " +
        "rotate it. See docs/operator-signer-mismatch.md. Funds are safe.",
    );
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(`check-agent-signer failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
