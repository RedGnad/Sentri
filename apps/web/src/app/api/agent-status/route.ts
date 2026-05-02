import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";

const AGENT_URL = process.env.AGENT_URL ?? process.env.NEXT_PUBLIC_AGENT_URL;
const LOCAL_CACHE_DIR = process.env.SENTRI_CACHE_DIR ?? "/tmp/sentri-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  // 1. Preferred path: read from the agent server (cross-process source of truth).
  if (AGENT_URL) {
    try {
      const res = await fetch(`${AGENT_URL.replace(/\/$/, "")}/state`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        return NextResponse.json({
          status: "unavailable",
          message: `Agent server returned ${res.status}`,
        });
      }
      const body = await res.json();
      return NextResponse.json(body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({
        status: "unavailable",
        message: `Agent server unreachable: ${msg}`,
      });
    }
  }

  // 2. Fallback: local cache (dev mode, agent running on the same machine).
  const file = path.join(LOCAL_CACHE_DIR, "state.json");
  if (!fs.existsSync(file)) {
    return NextResponse.json({
      status: "idle",
      message:
        "Agent has not run yet. Set AGENT_URL or run the agent locally with `pnpm --filter @steward/sdk agent`.",
    });
  }
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    const updatedAt = Number(parsed.updatedAt ?? parsed.lastActionTime ?? 0);
    const isRecent = Date.now() - updatedAt < 15 * 60_000;
    return NextResponse.json({
      status: isRecent ? "running" : "idle",
      ...parsed,
    });
  } catch (err) {
    return NextResponse.json({
      status: "unavailable",
      message: `Failed to read local cache: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
