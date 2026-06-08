import {
  keccak256,
  encodeAbiParameters,
  concat,
  pad,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Unpacked ERC-4337 v0.7 UserOperation as it arrives over ERC-7677 JSON-RPC.
// All numeric fields are hex strings.
export interface UnpackedUserOp {
  sender: Address;
  nonce: Hex;
  factory?: Address | null;
  factoryData?: Hex | null;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
}

// A 65-byte placeholder so gas estimation sees a realistic signature size.
export const DUMMY_SIGNATURE: Hex = `0x${"fa".repeat(65)}`;

function packTwo(hi: bigint, lo: bigint): Hex {
  // EntryPoint v0.7 packing: bytes32 = (hi << 128) | lo
  return pad(toHex((hi << 128n) | lo), { size: 32 });
}

function initCodeHash(factory?: Address | null, factoryData?: Hex | null): Hex {
  if (!factory || factory === "0x") return keccak256("0x");
  return keccak256(concat([factory, factoryData ?? "0x"]));
}

/**
 * Reproduce VerifyingPaymaster.getHash() exactly (account-abstraction v0.7).
 * Any divergence here makes every sponsorship signature recover to the wrong
 * address → the paymaster returns SIG_VALIDATION_FAILED (safe, but nothing is
 * sponsored). The Foundry test PaymasterTest locks the on-chain side.
 */
export function computePaymasterHash(params: {
  op: UnpackedUserOp;
  paymaster: Address;
  chainId: number;
  pmVerificationGasLimit: bigint;
  pmPostOpGasLimit: bigint;
  validUntil: number;
  validAfter: number;
}): Hex {
  const { op, paymaster, chainId } = params;

  const accountGasLimits = packTwo(
    BigInt(op.verificationGasLimit),
    BigInt(op.callGasLimit),
  );
  const gasFees = packTwo(
    BigInt(op.maxPriorityFeePerGas),
    BigInt(op.maxFeePerGas),
  );
  // The contract reads paymasterAndData[20:52] as a uint256 — that 32-byte
  // window is (paymasterVerificationGasLimit << 128) | paymasterPostOpGasLimit.
  const pmGasField =
    (params.pmVerificationGasLimit << 128n) | params.pmPostOpGasLimit;

  const encoded = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
      { type: "uint48" },
      { type: "uint48" },
    ],
    [
      op.sender,
      BigInt(op.nonce),
      initCodeHash(op.factory, op.factoryData),
      keccak256(op.callData),
      accountGasLimits,
      pmGasField,
      BigInt(op.preVerificationGas),
      gasFees,
      BigInt(chainId),
      paymaster,
      params.validUntil,
      params.validAfter,
    ],
  );
  return keccak256(encoded);
}

/** paymasterData (the bytes after paymaster+gas limits): abi.encode(validUntil, validAfter) ++ signature. */
export function buildPaymasterData(
  validUntil: number,
  validAfter: number,
  signature: Hex,
): Hex {
  const validity = encodeAbiParameters(
    [{ type: "uint48" }, { type: "uint48" }],
    [validUntil, validAfter],
  );
  return concat([validity, signature]);
}

/** Sign a sponsorship with the verifyingSigner key (EIP-191 personal_sign over getHash). */
export async function signPaymasterData(params: {
  signerPrivateKey: Hex;
  op: UnpackedUserOp;
  paymaster: Address;
  chainId: number;
  pmVerificationGasLimit: bigint;
  pmPostOpGasLimit: bigint;
  validUntil: number;
  validAfter: number;
}): Promise<Hex> {
  const account = privateKeyToAccount(params.signerPrivateKey);
  const hash = computePaymasterHash(params);
  // viem's raw-message signMessage applies the "\x19Ethereum Signed Message:\n32"
  // prefix — matching the contract's MessageHashUtils.toEthSignedMessageHash.
  const signature = await account.signMessage({ message: { raw: hash } });
  return buildPaymasterData(params.validUntil, params.validAfter, signature);
}

/** The address the on-chain paymaster must be deployed with as verifyingSigner. */
export function signerAddress(signerPrivateKey: Hex): Address {
  return privateKeyToAccount(signerPrivateKey).address;
}
