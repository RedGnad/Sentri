import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMessageAddress, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import {
  computePaymasterHash,
  signPaymasterData,
  buildPaymasterData,
  signerAddress,
  DUMMY_SIGNATURE,
  type UnpackedUserOp,
} from "./sign.js";

const op: UnpackedUserOp = {
  sender: "0x00000000000000000000000000000000000000be",
  nonce: "0x7",
  factory: null,
  factoryData: null,
  callData: "0xdeadbeef",
  callGasLimit: "0x186a0",
  verificationGasLimit: "0x186a0",
  preVerificationGas: "0x5208",
  maxFeePerGas: "0x3b9aca00",
  maxPriorityFeePerGas: "0x3b9aca00",
};

const common = {
  op,
  paymaster: "0x1111111111111111111111111111111111111111" as const,
  chainId: 16661,
  pmVerificationGasLimit: 75000n,
  pmPostOpGasLimit: 0n,
};

test("hash is deterministic", () => {
  const a = computePaymasterHash({ ...common, validUntil: 1000, validAfter: 0 });
  const b = computePaymasterHash({ ...common, validUntil: 1000, validAfter: 0 });
  assert.equal(a, b);
});

test("hash depends on the validity window", () => {
  const a = computePaymasterHash({ ...common, validUntil: 1000, validAfter: 0 });
  const b = computePaymasterHash({ ...common, validUntil: 2000, validAfter: 0 });
  assert.notEqual(a, b);
});

test("signed sponsorship recovers to the verifyingSigner", async () => {
  const key = generatePrivateKey();
  const expected = signerAddress(key);
  const validUntil = 9999;
  const validAfter = 0;

  const paymasterData = await signPaymasterData({
    signerPrivateKey: key,
    ...common,
    validUntil,
    validAfter,
  });

  // paymasterData = abi.encode(validUntil, validAfter) [64 bytes] ++ signature [65 bytes].
  const sig = ("0x" + paymasterData.slice(2 + 128)) as Hex;
  const hash = computePaymasterHash({ ...common, validUntil, validAfter });
  const recovered = await recoverMessageAddress({ message: { raw: hash }, signature: sig });

  assert.equal(recovered.toLowerCase(), expected.toLowerCase());
});

test("buildPaymasterData prefixes a 64-byte validity window", () => {
  const d = buildPaymasterData(1, 2, DUMMY_SIGNATURE);
  // 64 bytes validity + 65 bytes signature = 129 bytes = 258 hex chars.
  assert.equal(d.length, 2 + 258);
});
