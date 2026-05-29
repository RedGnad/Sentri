import test from "node:test";
import assert from "node:assert/strict";
import { recoverAuditEntry, type AuditRecoveryDeps, type ChainAuditEntry } from "./audit-recovery.js";

const entry: ChainAuditEntry = {
  source: "chain-fallback",
  logIndex: 2,
  timestamp: 1779410000000,
  action: "Rebalance",
  amountIn: "1000",
  amountOut: "2000",
  tvlAfter: "3000",
  intentHash: "0xintent",
  responseHash: "0xresponse",
  teeSigner: "0xsigner",
  teeAttestation: "0xattestation",
  deadline: 1779410300,
  txHash: "0xtx",
};

function deps(overrides: Partial<AuditRecoveryDeps> = {}): AuditRecoveryDeps {
  return {
    findByTxHash: () => null,
    findByIntentHash: () => null,
    findByResponseHash: () => null,
    findByVaultLog: () => null,
    downloadBlob: async () => null,
    readKvAudit: async () => null,
    readInference: async () => null,
    ...overrides,
  };
}

test("audit recovery enriches a chain entry from durable rootHash + 0G blob", async () => {
  const recovered = await recoverAuditEntry("0xvault", entry, deps({
    findByTxHash: (txHash) => txHash === "0xtx"
      ? {
          vaultAddress: "0xvault",
          txHash,
          logIndex: 2,
          intentHash: "0xintent",
          responseHash: "0xresponse",
          rootHash: "0xroot",
          storageTxHash: "0xstorage",
          action: "Rebalance",
          createdAt: 1,
          updatedAt: 2,
        }
      : null,
    downloadBlob: async (rootHash) => rootHash === "0xroot"
      ? {
          reasoning: "TEE reasoning survived the restart",
          confidence: 91,
          signedResponse: "signed",
          teeSignature: "sig",
          provider: "0xprovider",
          model: "0GM",
          verifiability: "tee",
          chatID: "chat",
        }
      : null,
  })) as Record<string, unknown>;

  assert.equal(recovered.source, "index-recovered");
  assert.equal(recovered.reasoning, "TEE reasoning survived the restart");
  assert.equal(recovered.storageRootHash, "0xroot");
  assert.equal(recovered.storageTxHash, "0xstorage");
});

test("audit recovery unwraps sentri.audit.v1 storage envelopes", async () => {
  const recovered = await recoverAuditEntry("0xvault", entry, deps({
    findByIntentHash: (intentHash) => intentHash === "0xintent"
      ? {
          vaultAddress: "0xvault",
          txHash: "0xtx",
          logIndex: 2,
          intentHash,
          responseHash: "0xresponse",
          rootHash: "0xroot",
          action: "Rebalance",
          createdAt: 1,
          updatedAt: 2,
        }
      : null,
    downloadBlob: async (rootHash) => rootHash === "0xroot"
      ? {
          schema: "sentri.audit.v1",
          vault: "0xvault",
          entry: {
            reasoning: "TEE reasoning inside the durable envelope",
            decision: "Rebalance",
            confidence: 88,
          },
        }
      : null,
  })) as Record<string, unknown>;

  assert.equal(recovered.source, "index-recovered");
  assert.equal(recovered.reasoning, "TEE reasoning inside the durable envelope");
  assert.equal(recovered.decision, "Rebalance");
  assert.equal(recovered.storageRootHash, "0xroot");
});

test("audit recovery maps V2 TeeReceipt fields from a sentri.inference.v1 blob", async () => {
  const recovered = await recoverAuditEntry("0xvault", entry, deps({
    findByTxHash: (txHash) => txHash === "0xtx"
      ? {
          vaultAddress: "0xvault",
          txHash,
          logIndex: 2,
          intentHash: "0xintent",
          responseHash: "0xresponse",
          rootHash: "0xroot",
          storageTxHash: "0xstorage",
          action: "Rebalance",
          createdAt: 1,
          updatedAt: 2,
        }
      : null,
    downloadBlob: async (rootHash) => rootHash === "0xroot"
      ? {
          schema: "sentri.inference.v1",
          vault: "0xvault",
          vaultAddress: "0xvault",
          agent: "0xagent",
          AgentINFT: "0xinft",
          oracleMode: "trustless-pyth",
          intentHash: "0xintent",
          responseHash: "0xresponse",
          teeSigner: "0xsigner",
          provider: "0xprovider",
          model: "0GM",
          reasoning: "V2 reasoning survived storage recovery",
          txHash: "0xtx",
          amountIn: "1000",
          amountOut: "2000",
          pythPriceId: "0xpyth",
          pythPublishTime: 1779410100,
          confidenceBps: 22,
          executionLogCount: 3,
        }
      : null,
  })) as Record<string, unknown>;

  assert.equal(recovered.source, "index-recovered");
  assert.equal(recovered.reasoning, "V2 reasoning survived storage recovery");
  assert.equal(recovered.oracleMode, "trustless-pyth");
  assert.equal(recovered.AgentINFT, "0xinft");
  assert.equal(recovered.txHash, "0xtx");
  assert.equal(recovered.amountIn, "1000");
  assert.equal(recovered.amountOut, "2000");
  assert.equal(recovered.pythPriceId, "0xpyth");
  assert.equal(recovered.confidenceBps, 22);
  assert.equal(recovered.storageRootHash, "0xroot");
});

test("audit recovery falls back to the chain-only entry when no record resolves", async () => {
  const recovered = await recoverAuditEntry("0xvault", entry, deps());
  assert.deepEqual(recovered, {
    ...entry,
    missingFields: [
      "reasoning",
      "canonicalRootHash",
      "canonicalStorageTxHash",
      "signedPayloadHash",
      "chatID",
      "provider",
    ],
  });
});
