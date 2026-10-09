import { NextResponse } from "next/server";
import { INDEXER_CHAIN_ID, getClient } from "@/lib/server/chains";
import { getDbOrNull } from "@/lib/server/db";
import { getSiteStatus } from "@/lib/server/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/status: measured health (chain RPC + indexer lag) behind the footer indicator. */
export async function GET() {
  const status = await getSiteStatus(getClient(INDEXER_CHAIN_ID), getDbOrNull());
  return NextResponse.json(status, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } });
}
