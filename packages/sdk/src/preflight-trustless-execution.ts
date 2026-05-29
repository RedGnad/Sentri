#!/usr/bin/env tsx
/**
 * pnpm --filter @steward/sdk preflight:trustless-execution
 *
 * Read-only, key-less pre-flight for a P4 executeStrategyWithPyth() run on the
 * canary vault. Checks every precondition that can be checked WITHOUT a key or
 * sealed inference, so the only sensitive step left (signing + send on the
 * secure box) is gated by a green pre-flight. Touches nothing on-chain.
 *
 * Gates:
 *  - agent OG balance covers (Pyth fee + gas headroom)
 *  - agent authorized for the vault (isAuthorizedForVault)
 *  - cooldown elapsed
 *  - vault has tradeable balance (base and/or risk)
 *  - Hermes 0G/USD update data non-empty
 *  - Pyth confidence within pythMaxConfBps (200)
 *  - getUpdateFee resolves on-chain
 *
 * Note on allowance: the vault approves the router in-tx (forceApprove inside
 * _doSwap), so no pre-existing token allowance is required from the caller.
 */

import { ethers } from "ethers";

const RPC = process.env.RPC_URL ?? "https://evmrpc.0g.ai";
const HERMES = process.env.HERMES_URL ?? "https://hermes.pyth.network";

const A = {
  vault: "0x86cE22c597D0C4EC309ba166360686C39A3f40ed",
  agent: "0x981F6E0Ea94f45fDB8ee7680DC862212E3C720e0",
  agentNFT: "0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951",
  pyth: "0x2880aB155794e7179c9eE2e38200202908C17B43",
  feedId: "0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070",
};
const PYTH_MAX_CONF_BPS = 200;
const GAS_HEADROOM_WEI = ethers.parseUnits("0.01", 18); // generous gas cushion on top of the Pyth fee

const VAULT_ABI = [
  "function base() view returns (address)",
  "function risk() view returns (address)",
  "function lastExecutionTime() view returns (uint256)",
  "function policy() view returns (uint16,uint16,uint16,uint16,uint32,uint32)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
const INFT_ABI = ["function isAuthorizedForVault(address,address) view returns (bool)"];
const PYTH_ABI = ["function getUpdateFee(bytes[]) view returns (uint256)"];

let blockers = 0;
function gate(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${detail}`);
  if (!ok) blockers++;
}
const og = (wei: bigint) => `${ethers.formatUnits(wei, 18)} OG`;

async function main() {
  console.log("=== Pre-flight: trustless execution on canary vault ===\n");
  const provider = new ethers.JsonRpcProvider(RPC);
  const vault = new ethers.Contract(A.vault, VAULT_ABI, provider);
  const inft = new ethers.Contract(A.agentNFT, INFT_ABI, provider);
  const pyth = new ethers.Contract(A.pyth, PYTH_ABI, provider);

  // Authorization
  console.log("Authorization");
  gate("agent authorized for vault", await inft.isAuthorizedForVault(A.agent, A.vault), "isAuthorizedForVault");

  // Cooldown
  console.log("\nCooldown");
  const last: bigint = await vault.lastExecutionTime();
  const [, , , , cooldown] = await vault.policy();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const elapsed = last === 0n ? cooldown : now - last;
  const cdOk = last === 0n || elapsed >= BigInt(cooldown);
  gate(
    "cooldown elapsed",
    cdOk,
    last === 0n ? "never executed (no cooldown)" : `${elapsed}s elapsed / ${cooldown}s required`,
  );

  // Vault tradeable balance
  console.log("\nVault balance");
  const baseAddr = await vault.base();
  const riskAddr = await vault.risk();
  const base = new ethers.Contract(baseAddr, ERC20_ABI, provider);
  const risk = new ethers.Contract(riskAddr, ERC20_ABI, provider);
  const [bBal, bDec, bSym, rBal, rDec, rSym] = await Promise.all([
    base.balanceOf(A.vault),
    base.decimals(),
    base.symbol(),
    risk.balanceOf(A.vault),
    risk.decimals(),
    risk.symbol(),
  ]);
  console.log(`    ${bSym}: ${ethers.formatUnits(bBal, bDec)} · ${rSym}: ${ethers.formatUnits(rBal, rDec)}`);
  gate("vault has tradeable balance", bBal > 0n || rBal > 0n, "fund the vault before executing");

  // Pyth update data + fee + confidence
  console.log("\nPyth oracle");
  const res = await fetch(`${HERMES}/v2/updates/price/latest?ids[]=${A.feedId}`);
  if (!res.ok) {
    gate("Hermes reachable", false, `HTTP ${res.status}`);
    return finish();
  }
  const json = (await res.json()) as {
    binary: { data: string[] };
    parsed: Array<{ price: { price: string; conf: string; expo: number; publish_time: number } }>;
  };
  const updateData = (json.binary?.data ?? []).map((d) => `0x${d}`);
  gate("Hermes update data non-empty", updateData.length > 0, `${updateData.length} blob(s)`);
  const p = json.parsed?.[0]?.price;
  if (p) {
    const confBps = Math.round((Number(p.conf) / Number(p.price)) * 10_000);
    const ageSec = Math.floor(Date.now() / 1000) - p.publish_time;
    console.log(`    0G/USD: $${(Number(p.price) * 10 ** p.expo).toFixed(5)} · conf ${confBps}bps · published ${ageSec}s ago`);
    gate("confidence within bound", confBps <= PYTH_MAX_CONF_BPS, `${confBps}bps (<= ${PYTH_MAX_CONF_BPS})`);
  }
  let fee = 0n;
  if (updateData.length > 0) {
    fee = await pyth.getUpdateFee(updateData);
    console.log(`    getUpdateFee: ${og(fee)}`);
  }

  // Agent OG balance vs fee + gas headroom
  console.log("\nAgent (operator) funding");
  const agentBal = await provider.getBalance(A.agent);
  const needed = fee + GAS_HEADROOM_WEI;
  console.log(`    agent ${A.agent}`);
  gate(
    "OG balance covers fee + gas headroom",
    agentBal >= needed,
    `${og(agentBal)} available, ${og(needed)} needed (fee ${og(fee)} + ~${og(GAS_HEADROOM_WEI)} gas)`,
  );

  finish();
}

function finish() {
  if (blockers > 0) {
    console.error(`\n✗ ${blockers} blocker(s) — do NOT send yet. Resolve the above first.`);
    process.exit(1);
  }
  console.log("\n✅ Pre-flight green — conditions are right to attempt executeStrategyWithPyth on the secure box.");
  console.log("   Note: the vault still re-verifies Pyth + slippage on-chain in the same tx; a swap that");
  console.log("   cannot clear slippage reverts safely (no funds moved).");
}

main().catch((err) => {
  console.error("\n💥 pre-flight failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
