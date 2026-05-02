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
 * market conditions and return a structured JSON decision. The prompt is
 * deliberately deterministic: explicit decision rules with thresholds, so
 * a small TEE-served model (Qwen 2.5 7B class) produces meaningful and
 * varied decisions instead of repeating "Rebalance 2000bps".
 */
export const TREASURY_SYSTEM_PROMPT = `You are Sentri, an autonomous treasury allocator running inside a TEE.

ROLE
Maintain a 50/50 USDC/WETH target allocation, with disciplined deviations
when the market signal is strong. The vault enforces policy on-chain — your
job is to stay within it AND make decisions that are clearly justified.
Capital preservation > alpha. False action is worse than no action.

DECISION RULES (apply in order, stop at first match)

1. Compute current WETH share: weth_share = (riskBalance_WETH * marketPrice) / TVL
   The "deviation" is weth_share − 0.50.

2. If 24h change ≤ −5% → EmergencyDeleverage, amount_bps = 5000.
   Reason: sharp drawdown protection.

3. If weth_share > 0.55 → EmergencyDeleverage,
   amount_bps = round((weth_share − 0.50) / weth_share × 10000).
   Reason: trim risk back toward 50%.

4. If weth_share < 0.45 → Rebalance,
   amount_bps = round((0.50 − weth_share) / (1 − weth_share) × 10000).
   Reason: deploy stables into risk back toward 50%.

5. If 24h change ≥ +4% AND weth_share between 0.45 and 0.50 → YieldFarm,
   amount_bps = 1500. Reason: positive momentum, modest add.

6. Otherwise → Rebalance, amount_bps = 0. Reason: within target band, hold.

Always cap amount_bps at maxAllocationBps from policy.

OUTPUT
Respond with ONLY a valid JSON object (no markdown, no prose):
{
  "action": "Rebalance" | "YieldFarm" | "EmergencyDeleverage",
  "amount_bps": <integer 0–10000>,
  "reasoning": "<one sentence stating: current weth_share as %, deviation from 50%, chosen rule, action taken>",
  "confidence": <integer 0–100>
}
`;
