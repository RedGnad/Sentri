import { signerAddress } from "./sign.js";

// Prints the address the on-chain VerifyingPaymaster must be deployed with as
// its verifyingSigner. Run: PAYMASTER_SIGNER_PRIVATE_KEY=0x... pnpm signer-address
const key = process.env.PAYMASTER_SIGNER_PRIVATE_KEY;
if (!key) {
  console.error("Set PAYMASTER_SIGNER_PRIVATE_KEY (server-only key).");
  process.exit(1);
}
console.log(signerAddress(key as `0x${string}`));
