import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { getDb } from "@/lib/server/db";
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
  const limit = Math.min(100, Math.max(1, Number(p.get("limit") ?? 50) || 50));

  if (!type || !TYPES.includes(type)) return bad("type must be incoming, outgoing, history or public");
  if (type !== "public" && !isAddress(user, { strict: false })) return bad("user must be a valid 0x address");
  if (cursor !== null && !/^\d{1,78}$/.test(cursor)) return bad("cursor must be a swap id");

  try {
    const page = await listSwaps(getDb(), { user, type, limit, cursor });
    return NextResponse.json(page, {
      headers: {
        "Cache-Control": "public, s-maxage=3, stale-while-revalidate=15",
        "Server-Timing": `total;dur=${(performance.now() - started).toFixed(1)}`,
      },
    });
  } catch (e) {
    console.error("swaps query failed", e);
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 });
  }
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
