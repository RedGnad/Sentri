// Lightweight, dependency-free (ethers-only) client for ExecutionRegistry.
//
// Read + verify + build-calldata helpers for builders integrating the shared
// registry. It NEVER holds a key or sends a transaction: signing and sending
// are the caller's responsibility. Wrapping these functions as an MCP server is
// a thin layer to add once @modelcontextprotocol/sdk can be installed.

import { ethers } from "ethers";

export const EXECUTION_REGISTRY_ABI = [
  "function register(address signer, address verifier, uint64 cooldown)",
  "function updateConfig(address signer, address verifier, uint64 cooldown)",
  "function recordExecution(bytes32 intentHash, string signedResponse, bytes signature, bytes32 attestation, bytes payload) returns (uint256)",
  "function receiptCount(address consumer) view returns (uint256)",
  "function receiptAt(address consumer, uint256 index) view returns (tuple(uint64 timestamp, address signer, bytes32 intentHash, bytes32 responseHash, bytes32 attestation, bytes32 payloadHash))",
  "function receipts(address consumer, uint256 start, uint256 limit) view returns (tuple(uint64 timestamp, address signer, bytes32 intentHash, bytes32 responseHash, bytes32 attestation, bytes32 payloadHash)[])",
  "function totalReceipts() view returns (uint256)",
  "function isRegistered(address consumer) view returns (bool)",
] as const;

export interface Receipt {
  timestamp: number;
  signer: string;
  intentHash: string;
  responseHash: string;
  attestation: string;
  payloadHash: string;
}

function toReceipt(r: {
  timestamp: bigint;
  signer: string;
  intentHash: string;
  responseHash: string;
  attestation: string;
  payloadHash: string;
}): Receipt {
  return {
    timestamp: Number(r.timestamp),
    signer: r.signer,
    intentHash: r.intentHash,
    responseHash: r.responseHash,
    attestation: r.attestation,
    payloadHash: r.payloadHash,
  };
}

/** Read-only client. Pass a provider and the deployed registry address. */
export class ExecutionRegistryReader {
  private readonly contract: ethers.Contract;

  constructor(address: string, provider: ethers.Provider) {
    this.contract = new ethers.Contract(address, EXECUTION_REGISTRY_ABI, provider);
  }

  async isRegistered(consumer: string): Promise<boolean> {
    return this.contract.isRegistered(consumer);
  }

  async receiptCount(consumer: string): Promise<number> {
    return Number(await this.contract.receiptCount(consumer));
  }

  async totalReceipts(): Promise<number> {
    return Number(await this.contract.totalReceipts());
  }

  async receiptAt(consumer: string, index: number): Promise<Receipt> {
    return toReceipt(await this.contract.receiptAt(consumer, index));
  }

  async receipts(consumer: string, start = 0, limit = 100): Promise<Receipt[]> {
    const page = await this.contract.receipts(consumer, start, limit);
    return page.map(toReceipt);
  }
}

/**
 * Re-verify a receipt off-chain against the original signed response.
 * Confirms (a) the response hashes to the stored `responseHash` and (b) the
 * EIP-191 signature recovers to the receipt's `signer`.
 */
export function verifyReceipt(
  receipt: Receipt,
  signedResponse: string,
  signature: string,
): { responseMatches: boolean; signerMatches: boolean; recoveredSigner: string } {
  const responseHash = ethers.keccak256(ethers.toUtf8Bytes(signedResponse));
  const recoveredSigner = ethers.verifyMessage(signedResponse, signature);
  return {
    responseMatches: responseHash.toLowerCase() === receipt.responseHash.toLowerCase(),
    signerMatches: recoveredSigner.toLowerCase() === receipt.signer.toLowerCase(),
    recoveredSigner,
  };
}

const iface = new ethers.Interface(EXECUTION_REGISTRY_ABI);

/** Build calldata for `register` (caller signs + sends). */
export function buildRegisterCalldata(signer: string, verifier: string, cooldownSeconds: number): string {
  return iface.encodeFunctionData("register", [signer, verifier, BigInt(cooldownSeconds)]);
}

/** Build calldata for `recordExecution` (caller signs + sends). */
export function buildRecordExecutionCalldata(args: {
  intentHash: string;
  signedResponse: string;
  signature: string;
  attestation: string;
  payload: string;
}): string {
  return iface.encodeFunctionData("recordExecution", [
    args.intentHash,
    args.signedResponse,
    args.signature,
    args.attestation,
    args.payload,
  ]);
}
