import { NextRequest, NextResponse } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";

const CACHE_DIR = process.env.SENTRI_CACHE_DIR ?? "/tmp/sentri-cache";

export async function GET(request: NextRequest) {
  const timestamp = request.nextUrl.searchParams.get("timestamp");
  if (!timestamp) {
    return NextResponse.json({ error: "Missing timestamp parameter" }, { status: 400 });
  }

  const file = path.join(CACHE_DIR, "audit", `${timestamp}.json`);
  if (!fs.existsSync(file)) {
    return NextResponse.json(
      { error: "No enriched audit entry found for this timestamp" },
      { status: 404 },
    );
  }

  try {
    const entry = JSON.parse(fs.readFileSync(file, "utf-8"));
    return NextResponse.json(entry);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read audit entry: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
