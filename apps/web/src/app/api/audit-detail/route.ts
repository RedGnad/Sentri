import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { KvClient } from "@0gfoundation/0g-ts-sdk";

const AUDIT_STREAM_ID = ethers.keccak256(ethers.toUtf8Bytes("sentri:audit-log"));
const KV_NODE_URL = process.env.OG_KV_NODE_URL || "https://indexer-storage-testnet-turbo.0g.ai";

function encodeKey(key: string): Uint8Array {
  return Uint8Array.from(Buffer.from(key, "utf-8"));
}

export async function GET(request: NextRequest) {
  const timestamp = request.nextUrl.searchParams.get("timestamp");
  if (!timestamp) {
    return NextResponse.json({ error: "Missing timestamp parameter" }, { status: 400 });
  }

  try {
    const kvClient = new KvClient(KV_NODE_URL);
    const logKey = `audit:${timestamp}`;
    const keyBytes = encodeKey(logKey);

    const val = await kvClient.getValue(AUDIT_STREAM_ID, keyBytes);
    if (!val) {
      return NextResponse.json({ error: "Audit entry not found in 0G Storage" }, { status: 404 });
    }

    const entry = JSON.parse(val.toString());
    return NextResponse.json(entry);
  } catch {
    return NextResponse.json({
      error: "Could not reach 0G Storage",
    }, { status: 503 });
  }
}
