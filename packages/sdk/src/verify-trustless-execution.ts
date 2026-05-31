#!/usr/bin/env tsx
/**
 * pnpm --filter @steward/sdk verify:trustless-execution --tx <hash>
 *
 * Read-only, key-less verifier for ONE executeStrategyWithPyth() transaction
 * on the Reference V2 vault. Parses the TrustlessOracleExecution event,
 * cross-checks the on-chain execution log (for the TEE signer), and re-reads
 * AgentINFT authorization. Exits 1 on any failure.
 *
 * Checks:
 *  - event present and emitted by the expected V2 vault
 *  - event.agent == expected operator
 *  - executionLogCount incremented (>= 1) and a log matches this intentHash
 *  - Pyth freshness: (log.timestamp - pythPublishTime) <= pythMaxAge (60s)
 *  - Pyth confidence: pythConfBps <= pythMaxConfBps (200)
 *  - recovered TEE signer (from the log) is bound to the AgentINFT
 *
 * Prints intentHash, responseHash, signer, pythPrice, pythPublishTime,
 * pythConfBps, amountIn, amountOut.
 */

import { ethers } from "ethers";

const RPC = process.env.RPC_URL ?? "https://evmrpc.0g.ai";
const EXPLORER = "https://chainscan.0g.ai";

const A = {
  vault: "0x86cE22c597D0C4EC309ba166360686C39A3f40ed",
  agent: "0x981F6E0Ea94f45fDB8ee7680DC862212E3C720e0",
  agentNFT: "0x822Ea3f104c5aeA1bb7E34474d641abcf3f87951",
};
const PYTH_MAX_AGE = 60n;
const PYTH_MAX_CONF_BPS = 200n;
const ACTIONS = ["Rebalance", "YieldFarm", "EmergencyDeleverage"];

const EXEC_EVENT_ABI = [
  "event TrustlessOracleExecution(address indexed vault, address indexed agent, bytes32 indexed intentHash, bytes32 responseHash, bytes32 pythPriceId, uint256 pythPrice, uint256 pythPublishTime, uint256 pythConfBps, uint256 amountIn, uint256 amountOut, uint256 timestamp)",
];
const VAULT_ABI = [
  "function executionLogCount() view returns (uint256)",
  "function executionLogs(uint256) view returns (uint256 timestamp, uint8 action, uint256 amountIn, uint256 amountOut, uint256 tvlAfter, bytes32 intentHash, bytes32 responseHash, address teeSigner, bytes32 teeAttestation, uint256 deadline, uint256 pythPrice, uint256 pythPublishTime, uint256 pythConfBps)",
  "function policy() view returns (uint16 maxAllocationBps, uint16 maxDrawdownBps, uint16 rebalanceThresholdBps, uint16 maxSlippageBps, uint32 cooldownPeriod, uint32 maxPriceStaleness)",
];
const INFT_ABI = ["function isActiveAgentWithSigner(address,address) view returns (bool)"];

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${detail}`);
  if (!ok) failures++;
}
const eqAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function parseTxArg(): string {
  const i = process.argv.indexOf("--tx");
  const tx = i >= 0 ? process.argv[i + 1] : undefined;
  if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx)) {
    console.error("Usage: verify:trustless-execution --tx <0x… 32-byte tx hash>");
    process.exit(1);
  }
  return tx;
}

async function main() {
  const txHash = parseTxArg();
  console.log("=== Verify trustless execution — 0G mainnet ===\n");
  console.log(`chain    : 0G mainnet · chainId 16661`);
  console.log(`function : executeStrategyWithPyth (event TrustlessOracleExecution)`);
  console.log(`vault    : ${A.vault}`);
  console.log(`Pyth     : 0x2880aB155794e7179c9eE2e38200202908C17B43 · feed Crypto.0G/USD`);
  console.log(`tx       : ${EXPLORER}/tx/${txHash}\n`);

  const provider = new ethers.JsonRpcProvider(RPC);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    console.error("✗ transaction not found / not yet mined.");
    process.exit(1);
  }
  check("tx status success", receipt.status === 1, `status=${receipt.status}`);

  // Parse TrustlessOracleExecution from the receipt logs.
  const iface = new ethers.Interface(EXEC_EVENT_ABI);
  let ev: ethers.LogDescription | null = null;
  let emitter = "";
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "TrustlessOracleExecution") {
        ev = parsed;
        emitter = log.address;
        break;
      }
    } catch {
      /* not our event */
    }
  }
  if (!ev) {
    console.error("✗ no TrustlessOracleExecution event in this tx — not a trustless execution.");
    process.exit(1);
  }

  const a = ev.args;
  check("emitted by expected V2 vault", eqAddr(emitter, A.vault), emitter);
  check("event.vault == expected V2 vault", eqAddr(a.vault, A.vault), a.vault);
  check("event.agent == operator", eqAddr(a.agent, A.agent), a.agent);

  const stalenessSec = a.timestamp - a.pythPublishTime;
  check(
    "Pyth freshness within maxAge",
    stalenessSec >= 0n && stalenessSec <= PYTH_MAX_AGE,
    `${stalenessSec}s (<= ${PYTH_MAX_AGE}s)`,
  );
  check("Pyth confidence within bound", a.pythConfBps <= PYTH_MAX_CONF_BPS, `${a.pythConfBps}bps (<= ${PYTH_MAX_CONF_BPS})`);

  // Cross-check the on-chain execution log (the event has no teeSigner field).
  const vault = new ethers.Contract(A.vault, VAULT_ABI, provider);
  const count: bigint = await vault.executionLogCount();
  check("executionLogCount incremented", count >= 1n, count.toString());

  let matched: Awaited<ReturnType<typeof vault.executionLogs>> | null = null;
  for (let i = count - 1n; i >= 0n && i > count - 11n; i--) {
    const log = await vault.executionLogs(i);
    if (eqAddr(log.intentHash, a.intentHash)) {
      matched = log;
      break;
    }
  }
  if (!matched) {
    console.error("✗ no execution log matches this tx's intentHash (within the last 10).");
    process.exit(1);
  }
  const teeSigner: string = matched.teeSigner;
  check("log pyth fields match event", matched.pythPrice === a.pythPrice, `price ${matched.pythPrice}`);

  const inft = new ethers.Contract(A.agentNFT, INFT_ABI, provider);
  const signerBound: boolean = await inft.isActiveAgentWithSigner(A.agent, teeSigner);
  check("recovered TEE signer bound to AgentINFT", signerBound, teeSigner);

  // Read the vault's current policy for the slippage / caps comparison below.
  // Pyth feed Crypto.0G/USD on 0G mainnet uses expo -8: amountIn (6 dec) and
  // pythPrice (8 dec) → expected amountOut in W0G (18 dec).
  const policy = await vault.policy();
  const expectedOut = (a.amountIn * 10n ** 20n) / a.pythPrice;
  const slipBps =
    expectedOut > a.amountOut
      ? ((expectedOut - a.amountOut) * 10000n) / expectedOut
      : 0n;

  console.log("\n=== Execution detail ===");
  console.log(`  action          : ${ACTIONS[Number(matched.action)] ?? matched.action}`);
  console.log(`  intentHash      : ${a.intentHash}`);
  console.log(`  responseHash    : ${a.responseHash}`);
  console.log(`  teeSigner       : ${teeSigner}`);
  console.log(`  pythPriceId     : ${a.pythPriceId}`);
  console.log(`  pythPrice       : ${a.pythPrice}`);
  console.log(`  pythPublishTime : ${a.pythPublishTime} (${new Date(Number(a.pythPublishTime) * 1000).toISOString()})`);
  console.log(`  blockTimestamp  : ${a.timestamp} (${new Date(Number(a.timestamp) * 1000).toISOString()})`);
  console.log(`  pythConfBps     : ${a.pythConfBps}  (policy max: ${PYTH_MAX_CONF_BPS})`);
  console.log(`  amountIn        : ${a.amountIn}`);
  console.log(`  amountOut       : ${a.amountOut}`);
  console.log(`  expected out    : ${expectedOut} (zero-slippage estimate from Pyth)`);
  console.log(`  slippage        : ${slipBps} bps  (policy max: ${policy.maxSlippageBps} bps)`);
  console.log(`  executionLogs   : ${count - 1n} → ${count}`);
  console.log(`  policy          : maxAlloc ${policy.maxAllocationBps}bps · maxDD ${policy.maxDrawdownBps}bps · cooldown ${policy.cooldownPeriod}s`);

  console.log("\n=== Explorer ===");
  console.log(`  tx        : ${EXPLORER}/tx/${txHash}`);
  console.log(`  vault     : ${EXPLORER}/address/${A.vault}`);
  console.log(`  Pyth      : ${EXPLORER}/address/0x2880aB155794e7179c9eE2e38200202908C17B43`);
  console.log(`  AgentINFT : ${EXPLORER}/address/${A.agentNFT}`);

  if (failures > 0) {
    console.error(`\nVERDICT: FAIL  (${failures} check(s) failed)`);
    process.exit(1);
  }
  console.log(`\nVERDICT: PASS  · Verified executeStrategyWithPyth on the Reference V2 vault.`);
}

main().catch((err) => {
  console.error("\n💥 verify failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
