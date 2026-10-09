import { NextResponse, type NextRequest } from "next/server";
import { getDbOrNull, markDbFailure } from "@/lib/server/db";
import { limited } from "@/lib/server/http";
import { getSiteStats } from "@/lib/server/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/stats: marketplace totals and the latest activity, from the indexer database. 503 when it is unavailable. */
export async function GET(req: NextRequest) {
  const blocked = await limited(req, "stats", 60);
  if (blocked) return blocked;
  const db = getDbOrNull();
  if (!db) return NextResponse.json({ error: "indexer unavailable" }, { status: 503 });
  try {
    return NextResponse.json(await getSiteStats(db), { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } });
  } catch (e) {
    markDbFailure();
    console.error("stats failed", e);
    return NextResponse.json({ error: "indexer unavailable" }, { status: 503 });
  }
}
