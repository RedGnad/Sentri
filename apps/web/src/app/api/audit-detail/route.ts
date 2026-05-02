import { NextRequest, NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";

const AGENT_URL = process.env.AGENT_URL ?? process.env.NEXT_PUBLIC_AGENT_URL;
const LOCAL_CACHE_DIR = process.env.SENTRI_CACHE_DIR ?? "/tmp/sentri-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const timestamp = request.nextUrl.searchParams.get("timestamp");
  if (!timestamp) {
    return NextResponse.json({ error: "Missing timestamp parameter" }, { status: 400 });
  }

  // 1. Preferred path: read from the agent server.
  if (AGENT_URL) {
    try {
      const res = await fetch(
        `${AGENT_URL.replace(/\/$/, "")}/audit/${encodeURIComponent(timestamp)}`,
        { cache: "no-store", signal: AbortSignal.timeout(5_000) },
      );
      if (res.status === 404) {
        return NextResponse.json(
          { error: "No enriched audit entry cached for this timestamp." },
          { status: 404 },
        );
      }
      if (!res.ok) {
        return NextResponse.json(
          { error: `Agent server returned ${res.status}` },
          { status: 502 },
        );
      }
      return NextResponse.json(await res.json());
    } catch (err) {
      return NextResponse.json(
        {
          error: `Agent server unreachable: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 502 },
      );
    }
  }

  // 2. Fallback: local cache.
  const file = path.join(LOCAL_CACHE_DIR, "audit", `${timestamp}.json`);
  if (!fs.existsSync(file)) {
    return NextResponse.json(
      { error: "No enriched audit entry found for this timestamp" },
      { status: 404 },
    );
  }
  try {
    return NextResponse.json(JSON.parse(fs.readFileSync(file, "utf-8")));
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read audit entry: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
