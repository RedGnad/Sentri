import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { KvClient } from "@0gfoundation/0g-ts-sdk";

const STATE_STREAM_ID = ethers.keccak256(ethers.toUtf8Bytes("sentri:portfolio-state"));
const KV_NODE_URL = process.env.OG_KV_NODE_URL || "https://indexer-storage-testnet-turbo.0g.ai";

function encodeKey(key: string): Uint8Array {
  return Uint8Array.from(Buffer.from(key, "utf-8"));
}

export async function GET() {
  try {
    const kvClient = new KvClient(KV_NODE_URL);
    const keyBytes = encodeKey("portfolio:current");

    const val = await kvClient.getValue(STATE_STREAM_ID, keyBytes);
    if (!val) {
      return NextResponse.json({
        status: "idle",
        message: "No portfolio state found. Agent may not have run yet.",
      });
    }

    const state = JSON.parse(val.toString());
    const isRecent = Date.now() - state.lastActionTime < 120_000; // < 2 min

    return NextResponse.json({
      status: isRecent ? "running" : "idle",
      ...state,
    });
  } catch {
    // If KV is not available, return a graceful fallback
    return NextResponse.json({
      status: "unavailable",
      message: "Could not reach 0G Storage. Agent status unknown.",
    });
  }
}
