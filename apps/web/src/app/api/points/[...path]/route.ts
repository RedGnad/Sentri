import { NextRequest, NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_URL ?? process.env.NEXT_PUBLIC_AGENT_URL;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  { params }: { params: { path?: string[] } },
) {
  if (!AGENT_URL) {
    return NextResponse.json(
      { error: "AGENT_URL not configured on the dashboard host" },
      { status: 503 },
    );
  }

  const path = (params.path ?? []).map(encodeURIComponent).join("/");
  const query = request.nextUrl.searchParams.toString();
  const suffix = query ? `/${path}?${query}` : `/${path}`;
  try {
    const res = await fetch(`${AGENT_URL.replace(/\/$/, "")}/points${suffix}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Agent server returned ${res.status}` },
        { status: 502 },
      );
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    return NextResponse.json(
      { error: `Agent server unreachable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
