// Direct end-to-end test of the gas-sponsorship stack on 0G, with NO frontend
// and NO manual account creation. It:
//   1. derives the Safe smart account from PRIVATE_KEY_SEND (computed, not "found"),
//   2. builds a sponsored UserOp (a harmless USDC.E approve(factory, 0)),
//   3. submits it through our self-hosted bundler,
//   4. our paymaster pays the gas.
// If it lands, gas sponsorship works for ANY user automatically.
//
// Run from apps/web:
//   PRIVATE_KEY_SEND=0x... npx tsx scripts/test-sponsorship.ts

import { createPublicClient, http, defineChain, encodeFunctionData, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  createPaymasterClient,
  entryPoint07Address,
} from "viem/account-abstraction";
import { toSafeSmartAccount } from "permissionless/accounts";

const RPC = process.env.RPC ?? "https://evmrpc.0g.ai";
const BUNDLER = process.env.BUNDLER_URL ?? "https://sentri-bundler.onrender.com/rpc";
const PAYMASTER = process.env.PAYMASTER_URL ?? "https://sentri-agent.onrender.com/paymaster";
const USDCE = "0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E" as const;
const FACTORY = "0x8e129b97df1b513099329aC50B4774f8BeE1d538" as const; // allowlisted target

let key = process.env.PRIVATE_KEY_SEND ?? "";
if (key && !key.startsWith("0x")) key = "0x" + key;
if (!key) throw new Error("set PRIVATE_KEY_SEND");

const og = defineChain({
  id: 16661,
  name: "0G",
  nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

async function main() {
  const publicClient = createPublicClient({ chain: og, transport: http(RPC) });
  const owner = privateKeyToAccount(key as `0x${string}`);

  const safeAccount = await toSafeSmartAccount({
    client: publicClient,
    owners: [owner],
    version: "1.4.1",
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });

  console.log("Signer (owner EOA):", owner.address);
  console.log("Smart account (Safe):", safeAccount.address);
  const deployed = await publicClient.getCode({ address: safeAccount.address });
  console.log("Safe already deployed:", !!deployed && deployed !== "0x");

  const paymasterClient = createPaymasterClient({ transport: http(PAYMASTER) });
  const bundlerClient = createBundlerClient({
    account: safeAccount,
    client: publicClient,
    transport: http(BUNDLER),
    paymaster: paymasterClient,
    userOperation: {
      estimateFeesPerGas: async () => {
        const fees = await publicClient.estimateFeesPerGas();
        return {
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        };
      },
    },
  });

  console.log("\nSending sponsored UserOp: USDC.E approve(factory, 0) (harmless)…");
  const hash = await bundlerClient.sendUserOperation({
    calls: [
      {
        to: USDCE,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [FACTORY, 0n] }),
      },
    ],
  });
  console.log("UserOp hash:", hash);

  const receipt = await bundlerClient.waitForUserOperationReceipt({ hash });
  console.log("\n✅ Mined in tx:", receipt.receipt.transactionHash);
  console.log("Success:", receipt.success);
  console.log("Actual gas cost (paid by paymaster):", receipt.actualGasCost.toString());
}

main().catch((e) => {
  console.error("\n❌ FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
