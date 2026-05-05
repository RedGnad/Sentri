import { ethers } from "ethers";
import { createRequire } from "node:module";
import type { ZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { CHAIN } from "./constants.js";

// 0.7.4 ESM build is broken — import the CJS entrypoint via createRequire.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require(
  "@0glabs/0g-serving-broker",
) as typeof import("@0glabs/0g-serving-broker");

export interface InferenceResult {
  modelResponse: string;
  signedResponse: string;
  teeSignature: string;
  responseHash: string;
  teeAttestation: string;
  chatID: string;
  verified: true;
  provider: string;
  model: string;
  endpoint: string;
  verifiability: string;
  teeSignerAddress: string;
}

let _broker: ZGComputeNetworkBroker | null = null;
let _providerInfo: ProviderInfo | null = null;

export interface ProviderInfo {
  address: string;
  model: string;
  endpoint: string;
  verifiability: string;
  teeSignerAddress: string;
  additionalInfo: Record<string, unknown>;
}

/**
 * Initialize the 0G Compute Network broker with a wallet.
 * Must be called once before any inference operations.
 */
export async function initInference(privateKey: string): Promise<ZGComputeNetworkBroker> {
  const provider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  _broker = await createZGComputeNetworkBroker(wallet);
  return _broker;
}

/**
 * Get the current broker instance. Throws if not initialized.
 */
export function getBroker(): ZGComputeNetworkBroker {
  if (!_broker) throw new Error("Inference broker not initialized. Call initInference() first.");
  return _broker;
}

/**
 * List available inference services and pick the first chatbot provider.
 * Caches the provider address for subsequent calls.
 */
export async function selectProvider(): Promise<ProviderInfo> {
  const broker = getBroker();
  const services = await broker.inference.listService();

  if (services.length === 0) {
    throw new Error("No inference services available on the network.");
  }

  const candidates = Array.from(services)
    .filter((service) => {
      if (service.serviceType !== "chatbot") return false;
      if (!service.teeSignerAcknowledged) return false;
      if (!service.teeSignerAddress || service.teeSignerAddress === ethers.ZeroAddress) return false;
      if (!isVerifiableService(service.verifiability)) return false;
      try {
        JSON.parse(service.additionalInfo);
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => Number(b.updatedAt - a.updatedAt));

  if (candidates.length === 0) {
    throw new Error("No acknowledged verifiable chatbot provider available; refusing to run Sentri strategy.");
  }

  const service = candidates[0];
  const { endpoint, model } = await broker.inference.getServiceMetadata(service.provider);
  const additionalInfo = JSON.parse(service.additionalInfo) as Record<string, unknown>;
  const teeSignerAddress = resolveTeeSignerAddress(service.teeSignerAddress, additionalInfo);
  if (!teeSignerAddress || teeSignerAddress === ethers.ZeroAddress) {
    throw new Error(`Provider ${service.provider} resolved to an empty TEE signer.`);
  }

  _providerInfo = {
    address: service.provider,
    model,
    endpoint,
    verifiability: service.verifiability,
    teeSignerAddress,
    additionalInfo,
  };

  return _providerInfo;
}

/**
 * Acknowledge a provider's TEE signer (required before first request).
 */
export async function acknowledgeProvider(providerAddress?: string): Promise<void> {
  const broker = getBroker();
  const addr = providerAddress ?? _providerInfo?.address;
  if (!addr) throw new Error("No provider address. Call selectProvider() first.");

  // First call creates the sub-account; wrap so re-runs are idempotent.
  try {
    await broker.inference.acknowledgeProviderSigner(addr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already") && !msg.includes("Acknowledge")) {
      throw err;
    }
  }
}

/**
 * Send an inference request through Sealed Inference (TEE).
 *
 * The request is processed inside a Trusted Execution Environment:
 * - Strategy reasoning is routed through the selected 0G verifiable TEE provider path
 * - Response is cryptographically signed by the TEE
 * - Response signature is checked off-chain and then by the vault on-chain
 */
export async function requestInference(
  prompt: string,
  systemPrompt?: string,
  providerAddress?: string,
): Promise<InferenceResult> {
  const broker = getBroker();
  const addr = providerAddress ?? _providerInfo?.address;
  if (!addr) throw new Error("No provider address. Call selectProvider() first.");

  // Get endpoint + model metadata
  const { endpoint, model } = await broker.inference.getServiceMetadata(addr);
  const providerInfo = await getProviderInfo(addr, endpoint, model);

  // Generate billing/auth headers (single-use)
  const headers = await broker.inference.getRequestHeaders(addr, prompt);

  // Build messages
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  // Send OpenAI-compatible request to TEE-backed endpoint
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Inference request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? "";

  // Extract chat ID for TEE verification
  const chatID = response.headers.get("ZG-Res-Key")
    ?? response.headers.get("zg-res-key")
    ?? "";
  if (!chatID) {
    throw new Error("Missing ZG-Res-Key chatID; refusing to execute without TEE response verification.");
  }

  // Verify TEE signature
  const verified = await broker.inference.processResponse(addr, chatID, content);
  if (verified !== true) {
    throw new Error(`TEE response verification failed or skipped (verified=${verified}).`);
  }

  const signatureUrl = await broker.inference.getChatSignatureDownloadLink(addr, chatID);
  const signatureResponse = await fetch(`${signatureUrl}?model=${encodeURIComponent(model)}`);
  if (!signatureResponse.ok) {
    throw new Error(`TEE chat signature fetch failed (${signatureResponse.status}).`);
  }
  const signaturePayload = await signatureResponse.json() as { text?: string; signature?: string };
  if (!signaturePayload.text || !signaturePayload.signature) {
    throw new Error("TEE chat signature payload missing text or signature.");
  }
  const recovered = ethers.verifyMessage(signaturePayload.text, signaturePayload.signature);
  if (recovered.toLowerCase() !== providerInfo.teeSignerAddress.toLowerCase()) {
    throw new Error(`TEE chat signature recovered ${recovered}, expected ${providerInfo.teeSignerAddress}.`);
  }

  const responseHash = ethers.keccak256(ethers.toUtf8Bytes(signaturePayload.text));

  const teeAttestation = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
    chatID,
    provider: addr,
    model,
    verifiability: providerInfo.verifiability,
    teeSignerAddress: providerInfo.teeSignerAddress,
    verified,
  })));

  return {
    modelResponse: content,
    signedResponse: signaturePayload.text,
    teeSignature: signaturePayload.signature,
    responseHash,
    teeAttestation,
    chatID,
    verified: true,
    provider: addr,
    model,
    endpoint,
    verifiability: providerInfo.verifiability,
    teeSignerAddress: providerInfo.teeSignerAddress,
  };
}

async function getProviderInfo(addr: string, endpoint: string, model: string): Promise<ProviderInfo> {
  if (_providerInfo?.address.toLowerCase() === addr.toLowerCase()) return _providerInfo;

  const broker = getBroker();
  const services = await broker.inference.listService(0, 50, true);
  const service = services.find((s) => s.provider.toLowerCase() === addr.toLowerCase());
  if (!service) throw new Error(`Provider ${addr} not found in 0G inference registry.`);
  if (!isVerifiableService(service.verifiability) || !service.teeSignerAcknowledged) {
    throw new Error(`Provider ${addr} is not an acknowledged verifiable service.`);
  }
  const additionalInfo = JSON.parse(service.additionalInfo) as Record<string, unknown>;
  const teeSignerAddress = resolveTeeSignerAddress(service.teeSignerAddress, additionalInfo);
  if (!teeSignerAddress || teeSignerAddress === ethers.ZeroAddress) {
    throw new Error(`Provider ${addr} resolved to an empty TEE signer.`);
  }
  return {
    address: service.provider,
    model,
    endpoint,
    verifiability: service.verifiability,
    teeSignerAddress,
    additionalInfo,
  };
}

function isVerifiableService(verifiability: string): boolean {
  const normalized = verifiability.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "none" && normalized !== "false" && normalized !== "0";
}

function resolveTeeSignerAddress(serviceSigner: string, additionalInfo: Record<string, unknown>): string {
  const targetSigner =
    additionalInfo.TargetSeparated === true && typeof additionalInfo.TargetTeeAddress === "string"
      ? additionalInfo.TargetTeeAddress.trim()
      : "";
  return targetSigner || serviceSigner;
}

/**
 * System prompt for the treasury agent — instructs the LLM to analyze
 * pre-computed market + portfolio metrics and return a structured JSON
 * decision. Stables-first mandate with bounded productive risk exposure.
 *
 * The prompt is deliberately deterministic (explicit thresholds, ordered
 * rules) so a small TEE-served model (Qwen 2.5 7B class) produces
 * meaningful, varied decisions instead of collapsing to a single mode.
 */
export const TREASURY_SYSTEM_PROMPT = `You are Sentri, an autonomous treasury agent for stablecoin reserves served through a 0G verifiable TEE provider path.

ROLE
The vault holds a base stable asset as the home asset: MockUSDC on Galileo
rehearsal deployments, and USDC.E / bridged USDC for the 0G mainnet asset
model. Mandate: keep the treasury stables-first and deploy a bounded portion
to the configured risk asset only when conditions are constructive. Never
compromise the stables-first nature.

POSITION ENVELOPE
- Default state: 100% base stable asset
- Maximum risk-asset exposure: 30% of TVL. Never exceed.
- Target band when deployed: 20–30% risk asset

DECISION RULES (apply in order, stop at first match)

Use the pre-computed metrics in the user prompt:
- current_weth_share (already computed as a percentage of TVL)
- 24h change (market signal)
- drawdown_from_HWM (capital preservation signal)

1. If 24h change ≤ −3% OR drawdown_from_HWM ≥ 1.5%
   → EmergencyDeleverage. Exit all (or near all) risk asset back to the base stable asset.
   Reason: capital preservation, return to stables.

2. If current_weth_share > 30%
   → EmergencyDeleverage. Trim back toward the 25% target with a small buffer.
   Reason: above the maximum risk envelope.

3. If 20% ≤ current_weth_share ≤ 30%
   → Rebalance, amount_bps = 0.
   Reason: in target band, hold.

4. If current_weth_share < 20% AND 24h change ≥ +1% AND drawdown_from_HWM < 1%
   → Rebalance. Deploy base stable asset to bring weth_share toward 25%.
   Reason: constructive market, productive deployment warranted.

5. Otherwise
   → Rebalance, amount_bps = 0.
   Reason: cautious default, ambiguous signal.

Always cap amount_bps at maxAllocationBps from policy.

OUTPUT
Respond with ONLY a valid JSON object (no markdown, no prose):
{
  "action": "Rebalance" | "YieldFarm" | "EmergencyDeleverage",
  "amount_bps": <integer 0–10000>,
  "rule_id": "R1" | "R2" | "R3" | "R4" | "R5",
  "confidence": <integer 0–100>,
  "short_reason": "<one short public sentence: current_weth_share %, market signal, drawdown, chosen rule>"
}
`;
