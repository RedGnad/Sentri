import { ethers } from "ethers";
import {
  createZGComputeNetworkBroker,
  type ZGComputeNetworkBroker,
} from "@0glabs/0g-serving-broker";
import { CHAIN } from "./constants.js";

export interface InferenceResult {
  content: string;
  proofHash: string;
  teeAttestation: string;
  chatID: string;
  verified: boolean | null;
}

let _broker: ZGComputeNetworkBroker | null = null;
let _providerAddress: string | null = null;

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
export async function selectProvider(): Promise<{ address: string; model: string; endpoint: string }> {
  const broker = getBroker();
  const services = await broker.inference.listService();

  if (services.length === 0) {
    throw new Error("No inference services available on the network.");
  }

  // Pick the first available service
  const service = services[0];
  _providerAddress = service.provider;

  const { endpoint, model } = await broker.inference.getServiceMetadata(service.provider);

  return { address: service.provider, model, endpoint };
}

/**
 * Acknowledge a provider's TEE signer (required before first request).
 */
export async function acknowledgeProvider(providerAddress?: string): Promise<void> {
  const broker = getBroker();
  const addr = providerAddress ?? _providerAddress;
  if (!addr) throw new Error("No provider address. Call selectProvider() first.");

  const isAcknowledged = await broker.inference.acknowledged(addr);
  if (!isAcknowledged) {
    await broker.inference.acknowledgeProviderSigner(addr);
  }
}

/**
 * Send an inference request through Sealed Inference (TEE).
 *
 * The request is processed inside a Trusted Execution Environment:
 * - Strategy reasoning stays private (encrypted in-enclave)
 * - Response is cryptographically signed by the TEE
 * - Signature can be verified on-chain via proofHash
 */
export async function requestInference(
  prompt: string,
  systemPrompt?: string,
  providerAddress?: string,
): Promise<InferenceResult> {
  const broker = getBroker();
  const addr = providerAddress ?? _providerAddress;
  if (!addr) throw new Error("No provider address. Call selectProvider() first.");

  // Get endpoint + model metadata
  const { endpoint, model } = await broker.inference.getServiceMetadata(addr);

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
    ?? data.id
    ?? "";

  // Verify TEE signature
  const verified = await broker.inference.processResponse(addr, chatID, content);

  // Generate proof hashes for on-chain logging
  const proofHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
    prompt,
    response: content,
    chatID,
    timestamp: Date.now(),
  })));

  const teeAttestation = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({
    chatID,
    provider: addr,
    verified,
  })));

  return {
    content,
    proofHash,
    teeAttestation,
    chatID,
    verified,
  };
}

/**
 * System prompt for the treasury agent — instructs the LLM to analyze
 * market conditions and return a structured JSON decision.
 */
export const TREASURY_SYSTEM_PROMPT = `You are Sentri, an autonomous stablecoin treasury agent.
Your job is to analyze market data and recommend treasury actions.

You MUST respond with ONLY a valid JSON object (no markdown, no explanation):
{
  "action": "Rebalance" | "YieldFarm" | "EmergencyDeleverage",
  "amount_bps": <number 1-10000, basis points of vault balance to use>,
  "reasoning": "<brief explanation of your decision>",
  "confidence": <number 0-100>
}

Rules:
- Be conservative. Capital preservation is priority #1.
- Only recommend EmergencyDeleverage if you detect significant risk.
- amount_bps should respect the vault's maxAllocationBps policy.
- If market conditions are stable and no action is needed, use Rebalance with amount_bps: 0.
`;
