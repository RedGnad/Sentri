import test from "node:test";
import assert from "node:assert/strict";
import { discoverVaultsV2, type GlobalContext } from "./agent.js";

// Minimal GlobalContext stub. The runtime expects an ethers.Contract on
// `factoryV2`, but discoverVaultsV2 only touches `.vaultCount()` and
// `.allVaults(i)` — so a duck-typed object is enough to exercise the
// contract here without bringing up ethers or RPCs.
function ctxWith(factoryV2: unknown): GlobalContext {
  return { factoryV2 } as unknown as GlobalContext;
}

test("discoverVaultsV2 returns [] when factoryV2 is null (flag off / not configured)", async () => {
  const result = await discoverVaultsV2(ctxWith(null));
  assert.deepEqual(result, []);
});

test("discoverVaultsV2 returns [] when vaultCount = 0n", async () => {
  const factoryV2 = {
    vaultCount: async () => 0n,
    allVaults: async () => {
      throw new Error("must not be called when count = 0");
    },
  };
  const result = await discoverVaultsV2(ctxWith(factoryV2));
  assert.deepEqual(result, []);
});

test("discoverVaultsV2 reads N addresses sequentially when vaultCount = N", async () => {
  const addresses = [
    "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa",
    "0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb",
    "0xCCCCccccCCCCccccCCCCccccCCCCccccCCCCcccc",
  ];
  const factoryV2 = {
    vaultCount: async () => BigInt(addresses.length),
    allVaults: async (i: number) => addresses[i],
  };
  const result = await discoverVaultsV2(ctxWith(factoryV2));
  assert.deepEqual(result, addresses);
});

test("discoverVaultsV2 swallows errors and returns [] — V1 hot path must never be blocked", async () => {
  const factoryV2 = {
    vaultCount: async () => {
      throw new Error("simulated RPC failure on VaultFactoryV2.vaultCount");
    },
    allVaults: async () => {
      throw new Error("must not be called when vaultCount throws");
    },
  };
  const result = await discoverVaultsV2(ctxWith(factoryV2));
  assert.deepEqual(result, []);
});

test("discoverVaultsV2 swallows mid-iteration errors and returns [] (atomicity over partial result)", async () => {
  const factoryV2 = {
    vaultCount: async () => 3n,
    allVaults: async (i: number) => {
      if (i === 1) throw new Error("simulated transient RPC error mid-iteration");
      return "0x0000000000000000000000000000000000000000";
    },
  };
  const result = await discoverVaultsV2(ctxWith(factoryV2));
  // Partial result would be misleading (allowlist filter would still skip the
  // missing one but the operator gets no clear signal); return [] and let the
  // next cycle retry cleanly.
  assert.deepEqual(result, []);
});
