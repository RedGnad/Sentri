import type { AuditIndexRecord } from "./audit-index.js";
import type { AuditEntry, InferenceRecord } from "./storage.js";

export type ChainAuditEntry = {
  source: "chain-fallback";
  logIndex: number;
  timestamp: number;
  action: string;
  amountIn: string;
  amountOut: string;
  tvlAfter: string;
  intentHash: string;
  responseHash: string;
  teeSigner: string;
  teeAttestation: string;
  deadline: number;
  txHash?: string;
};

type InferenceLike = Record<string, unknown>;

export interface AuditRecoveryDeps {
  findByTxHash(txHash: string): AuditIndexRecord | null;
  findByIntentHash(intentHash: string): AuditIndexRecord | null;
  findByResponseHash(responseHash: string): AuditIndexRecord | null;
  findByVaultLog(vaultAddress: string, logIndex: number): AuditIndexRecord | null;
  downloadBlob(rootHash: string): Promise<unknown | null>;
  readKvAudit(vaultAddress: string, entry: ChainAuditEntry): Promise<AuditEntry | null>;
  readInference(vaultAddress: string, intentHash: string): Promise<InferenceRecord | null>;
}

function computeMissingFields(
  entry: ChainAuditEntry,
  inference: InferenceLike,
  storage?: { rootHash?: string; txHash?: string },
): string[] {
  const missing: string[] = [];
  if (!entry.txHash) missing.push("txHash");
  if (!storage?.rootHash) missing.push("canonicalRootHash");
  if (!storage?.txHash) missing.push("canonicalStorageTxHash");
  if (!inference.reasoning) missing.push("reasoning");
  if (!inference.signedPayloadHash) missing.push("signedPayloadHash");
  if (!inference.chatID) missing.push("chatID");
  return missing;
}

function mapInferenceOntoEntry(
  entry: ChainAuditEntry,
  inference: InferenceLike,
  source: string,
  storage?: { rootHash?: string; txHash?: string },
): unknown {
  return {
    ...entry,
    source,
    amount: inference.amount,
    intent: inference.intent,
    rawResponseHash: inference.rawResponseHash,
    signedPayloadHash: inference.signedPayloadHash,
    modelResponse: inference.modelResponse,
    signedResponse: inference.signedResponse,
    teeSignature: inference.teeSignature,
    recoveredSigner: inference.recoveredSigner,
    expectedSigner: inference.expectedSigner,
    signerMatchedProvider: inference.signerMatchedProvider,
    processResponseVerified: inference.processResponseVerified,
    verified: inference.verified,
    provider: inference.provider,
    providerEndpoint: inference.providerEndpoint,
    model: inference.model,
    verifiability: inference.verifiability,
    chatID: inference.chatID,
    decision: inference.decision,
    reasoning: inference.reasoning,
    amountBps: inference.amountBps,
    ruleId: inference.ruleId,
    confidence: inference.confidence,
    marketPrice: inference.marketPrice,
    marketSource: inference.marketSource,
    marketSpreadPct: inference.marketSpreadPct,
    marketSourceCount: inference.marketSourceCount,
    marketRequiredSourceCount: inference.marketRequiredSourceCount,
    marketRawSources: inference.marketRawSources,
    priceAttestationPayload: inference.priceAttestationPayload,
    // Canonical field names — match CachedAuditEntry schema used by the live cache.
    canonicalStorageTxHash: storage?.txHash ?? undefined,
    canonicalRootHash: storage?.rootHash ?? undefined,
    kvIndexTxHash: inference.kvTxHash,
    kvIndexRootHash: inference.kvRootHash,
    missingFields: computeMissingFields(entry, inference, storage),
  };
}

function unwrapAuditBlob(blob: unknown): InferenceLike | null {
  if (!blob || typeof blob !== "object") return null;
  const envelope = blob as InferenceLike;
  if (envelope.entry && typeof envelope.entry === "object") {
    return { ...envelope, ...(envelope.entry as InferenceLike) };
  }
  return envelope;
}

export async function recoverAuditEntry(
  vaultAddress: string,
  entry: ChainAuditEntry,
  deps: AuditRecoveryDeps,
): Promise<unknown> {
  try {
    const idxRec =
      (entry.txHash ? deps.findByTxHash(entry.txHash) : null) ??
      deps.findByIntentHash(entry.intentHash) ??
      deps.findByResponseHash(entry.responseHash) ??
      deps.findByVaultLog(vaultAddress, entry.logIndex);
    if (idxRec?.rootHash) {
      const blob = await deps.downloadBlob(idxRec.rootHash);
      const inference = unwrapAuditBlob(blob);
      if (inference) {
        return mapInferenceOntoEntry(entry, inference, "index-recovered", {
          rootHash: idxRec.rootHash,
          txHash: idxRec.storageTxHash,
        });
      }
    }
    if (entry.txHash) {
      const kvAudit = await deps.readKvAudit(vaultAddress, entry);
      if (kvAudit) return mapInferenceOntoEntry(entry, kvAudit as unknown as InferenceLike, "inference-fallback");
    }
    const inference = await deps.readInference(vaultAddress, entry.intentHash);
    if (!inference) {
      return {
        ...entry,
        missingFields: [
          ...(!entry.txHash ? ["txHash"] : []),
          "reasoning", "canonicalRootHash", "canonicalStorageTxHash",
          "signedPayloadHash", "chatID", "provider",
        ],
      };
    }
    return mapInferenceOntoEntry(entry, inference as unknown as InferenceLike, "inference-fallback");
  } catch {
    return entry;
  }
}
