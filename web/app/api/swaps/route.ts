import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { getDbOrNull, markDbFailure } from "@/lib/server/db";
import { isTokenId, limited } from "@/lib/server/http";
import { listSwaps, type SwapListType } from "@/lib/server/swaps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: readonly SwapListType[] = ["incoming", "outgoing", "history", "public"];

/** GET /api/swaps?user=0x…&type=incoming|outgoing|history|public[&limit=50][&cursor=<swapId>]  (`user` is not needed for `public`) */
export async function GET(req: NextRequest) {
  const started = performance.now();
  const p = req.nextUrl.searchParams;
  const user = p.get("user") ?? "";
  const type = p.get("type") as SwapListType | null;
  const cursor = p.get("cursor");
  const rawLimit = p.get("limit") ?? "50";
  const limit = Number(rawLimit);

  if (!type || !TYPES.includes(type)) return bad("type must be incoming, outgoing, history or public");
  if (type !== "public" && !isAddress(user, { strict: false })) return bad("user must be a valid 0x address");
  if (!/^\d{1,3}$/.test(rawLimit) || limit < 1 || limit > 100) return bad("limit must be an integer from 1 to 100");
  if (cursor !== null && !isTokenId(cursor)) return bad("cursor must be a uint256 swap id");

  const blocked = await limited(req, "swaps", 120);
  if (blocked) return blocked;

  try {
    const db = getDbOrNull();
    if (!db) return NextResponse.json({ error: "indexer unavailable" }, { status: 503 });
    const page = await listSwaps(db, { user, type, limit, cursor });
    return NextResponse.json(page, {
      headers: {
        "Cache-Control": "public, s-maxage=3, stale-while-revalidate=15",
        "Server-Timing": `total;dur=${(performance.now() - started).toFixed(1)}`,
      },
    });
  } catch (e) {
    markDbFailure();
    console.error("swaps query failed", e);
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 });
  }
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
