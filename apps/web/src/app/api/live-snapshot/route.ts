import { NextResponse } from "next/server";
import { getLiveSnapshot } from "@/lib/live-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(await getLiveSnapshot());
}
