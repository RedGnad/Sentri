import { type Address, type Hex } from "viem";

// ── Service configuration (all from env; secrets are server-only) ───────────
// PAYMASTER_SIGNER_PRIVATE_KEY is the off-chain key the on-chain
// VerifyingPaymaster trusts. It must live ONLY on the server (Render) — never
// in any NEXT_PUBLIC_ var, the frontend, or Vercel.

export const config = {
  port: Number(process.env.PORT ?? 8787),

  // 0G mainnet by default. EntryPoint v0.7 is the canonical singleton verified
  // deployed on 0G.
  chainId: Number(process.env.PAYMASTER_CHAIN_ID ?? 16661),
  entryPoint: (process.env.ENTRYPOINT ??
    "0x0000000071727De22E5E9d8BAf0edAc6f37da032") as Address,

  // The deployed VerifyingPaymaster contract + the signer key it trusts.
  paymasterAddress: (process.env.PAYMASTER_ADDRESS ?? "") as Address,
  signerPrivateKey: (process.env.PAYMASTER_SIGNER_PRIVATE_KEY ?? "") as Hex,

  // How long a sponsorship signature stays valid (seconds).
  validitySeconds: Number(process.env.PAYMASTER_VALIDITY_SECONDS ?? 3600),

  // Paymaster gas limits. These are signed over (they land in paymasterAndData
  // [20:52]) so the value here must equal what's returned to the bundler.
  pmVerificationGasLimit: BigInt(
    process.env.PAYMASTER_VERIFICATION_GAS_LIMIT ?? "75000",
  ),
  pmPostOpGasLimit: BigInt(process.env.PAYMASTER_POSTOP_GAS_LIMIT ?? "0"),

  // ── Sponsorship policy ───────────────────────────────────────────────────
  // Only sponsor UserOps whose Safe-wrapped call targets one of these
  // addresses (comma-separated). Keep this to Sentri contracts (vault factory,
  // base token, vaults) so the paymaster can't be drained on arbitrary calls.
  targetAllowlist: (process.env.PAYMASTER_TARGET_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Escape hatch for local testing ONLY — sponsors every UserOp. Never enable
  // in production: it lets anyone spend the paymaster's gas balance.
  allowAll: (process.env.PAYMASTER_ALLOW_ALL ?? "false") === "true",
};

/** Throw early at server start if required server secrets/addresses are unset. */
export function assertServerConfig(): void {
  if (!config.paymasterAddress) throw new Error("PAYMASTER_ADDRESS unset");
  if (!config.signerPrivateKey) throw new Error("PAYMASTER_SIGNER_PRIVATE_KEY unset");
  if (config.allowAll) {
    console.warn(
      "[paymaster] WARNING: PAYMASTER_ALLOW_ALL=true — sponsoring EVERY UserOp. " +
        "Test only. Disable before exposing publicly.",
    );
  } else if (config.targetAllowlist.length === 0) {
    console.warn(
      "[paymaster] WARNING: empty PAYMASTER_TARGET_ALLOWLIST — every sponsorship " +
        "will be rejected until you add Sentri contract addresses.",
    );
  }
}
