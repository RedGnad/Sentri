import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";

const CACHE_DIR = process.env.SENTRI_CACHE_DIR ?? "/tmp/sentri-cache";

export async function GET() {
  const stateFile = path.join(CACHE_DIR, "state.json");

  if (!fs.existsSync(stateFile)) {
    return NextResponse.json({
      status: "idle",
      message: "Agent has not run yet. Start it with `pnpm --filter @steward/sdk agent`.",
    });
  }

  try {
    const raw = fs.readFileSync(stateFile, "utf-8");
    const state = JSON.parse(raw);
    const lastTime = Number(state.updatedAt ?? state.lastActionTime ?? 0);
    const isRecent = Date.now() - lastTime < 120_000;

    return NextResponse.json({
      status: isRecent ? "running" : "idle",
      ...state,
    });
  } catch (err) {
    return NextResponse.json({
      status: "unavailable",
      message: `Failed to read agent state: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
