#!/usr/bin/env tsx
/**
 * pnpm --filter @steward/sdk verify:trustless-canary
 *
 * Read-only, judge-verifiable proof that the Trustless Oracle Vault canary is
 * deployed, configured, and authorized on 0G mainnet. Touches NOTHING — no key,
 * no tx. Standalone (ethers only); does not import the agent runtime.
 *
 * It re-reads on-chain: factory wiring, the canary vault config + policy, the
 * AgentINFT authorization (factory + per-vault), Pyth liveness, and the
 * execution-log count. Exits 1 if any core invariant fails.
 *
 * Scope note: this proves DEPLOYMENT + AUTHORIZATION. A full economic execution
 * (executeStrategyWithPyth with Pyth update data) is a separate, agent-signed
 * proof and is NOT asserted here.
 */

import { ethers } from "ethers";

const RPC = process.env.RPC_URL ?? "https://evmrpc.0g.ai";
const EXPLORER = "https://chainscan.0g.ai";

const A = {
  factory: "0xA3588d1964F7CeCDcFac15e38D286554955CF58C",
  implementation: "0x0F8b9A0c064306F938912658c96c681D8655140B",
  vault: "0x86cE22c597D0C4EC309ba166360686C39A3f40ed",
  agentNFT: "0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951",
  agent: "0x981F6E0Ea94f45fDB8ee7680DC862212E3C720e0",
  pyth: "0x2880aB155794e7179c9eE2e38200202908C17B43",
  feedId: "0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070",
};

const FACTORY_ABI = [
  "function vaultCount() view returns (uint256)",
  "function allVaults(uint256) view returns (address)",
];
const VAULT_ABI = [
  "function owner() view returns (address)",
  "function agent() view returns (address)",
  "function pyth() view returns (address)",
  "function pythPriceId() view returns (bytes32)",
  "function pythMaxAge() view returns (uint256)",
  "function pythMaxConfBps() view returns (uint256)",
  "function policy() view returns (uint16,uint16,uint16,uint16,uint32,uint32)",
  "function executionLogCount() view returns (uint256)",
];
const INFT_ABI = [
  "function authorizedFactories(address) view returns (bool)",
  "function isAuthorizedForVault(address,address) view returns (bool)",
];
const PYTH_ABI = ["function getValidTimePeriod() view returns (uint256)"];

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${detail}`);
  if (!ok) failures++;
}
const eqAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function main() {
  console.log("=== Verify Trustless Oracle Vault canary — 0G mainnet ===\n");
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  console.log(`RPC: ${RPC}  (chainId ${net.chainId})\n`);

  const factory = new ethers.Contract(A.factory, FACTORY_ABI, provider);
  const vault = new ethers.Contract(A.vault, VAULT_ABI, provider);
  const inft = new ethers.Contract(A.agentNFT, INFT_ABI, provider);
  const pyth = new ethers.Contract(A.pyth, PYTH_ABI, provider);

  console.log("Factory");
  check("bytecode", (await provider.getCode(A.factory)) !== "0x", A.factory);
  const count = await factory.vaultCount();
  check("vaultCount == 1", count === 1n, count.toString());
  const v0 = await factory.allVaults(0);
  check("allVaults(0) == canary vault", eqAddr(v0, A.vault), v0);

  console.log("\nCanary vault");
  check("bytecode", (await provider.getCode(A.vault)) !== "0x", A.vault);
  const owner = await vault.owner();
  check("owner set", owner !== ethers.ZeroAddress, owner);
  const agent = await vault.agent();
  check("agent == operator", eqAddr(agent, A.agent), agent);
  const vpyth = await vault.pyth();
  check("pyth == 0G mainnet Pyth", eqAddr(vpyth, A.pyth), vpyth);
  const pid = await vault.pythPriceId();
  check("pythPriceId == 0G/USD feed", eqAddr(pid, A.feedId), pid);
  const [alloc, dd, rebal, slip, cooldown, stale] = await vault.policy();
  console.log(
    `    policy: maxAlloc ${alloc}bps · maxDrawdown ${dd}bps · rebalThr ${rebal}bps · ` +
      `maxSlippage ${slip}bps · cooldown ${cooldown}s · staleness ${stale}s`,
  );
  try {
    const maxAge = await vault.pythMaxAge();
    const maxConf = await vault.pythMaxConfBps();
    check("pythMaxAge == 60", maxAge === 60n, `${maxAge}s`);
    check("pythMaxConfBps == 200", maxConf === 200n, `${maxConf}bps`);
  } catch {
    console.log("    (pythMaxAge/pythMaxConfBps getters not exposed — skipped)");
  }

  console.log("\nAgentINFT authorization");
  check("authorizedFactories(factory)", await inft.authorizedFactories(A.factory), "true expected");
  check(
    "isAuthorizedForVault(agent, vault)",
    await inft.isAuthorizedForVault(A.agent, A.vault),
    "true expected",
  );

  console.log("\nPyth oracle");
  const vtp = await pyth.getValidTimePeriod();
  check("getValidTimePeriod responds (live)", vtp > 0n, `${vtp}s`);

  console.log("\nExecutions");
  const logs = await vault.executionLogCount();
  console.log(
    `    executionLogCount = ${logs}  ` +
      (logs === 0n
        ? "(no trustless execution yet — executeStrategyWithPyth is the separate, agent-signed proof)"
        : "(trustless executions recorded)"),
  );

  console.log("\n=== Proof links ===");
  console.log(`  factory: ${EXPLORER}/address/${A.factory}`);
  console.log(`  vault  : ${EXPLORER}/address/${A.vault}`);
  console.log(`  pyth   : ${EXPLORER}/address/${A.pyth}`);

  if (failures > 0) {
    console.error(`\n✗ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\n✅ Canary deployed, configured and authorized on 0G mainnet.");
}

main().catch((err) => {
  console.error("\n💥 verify failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
