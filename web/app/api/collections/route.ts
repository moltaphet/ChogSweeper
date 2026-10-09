import { NextResponse, type NextRequest } from "next/server";
import { INDEXER_CHAIN_ID, getClient } from "@/lib/server/chains";
import { verifiedCollections } from "@/lib/server/collections";
import { getDbOrNull } from "@/lib/server/db";
import { limited } from "@/lib/server/http";
import { getRegistry } from "@/lib/server/registry";
import { getCollectionNames } from "@/lib/server/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/collections: the verified collection registry (Chog first), for the landing page's Ecosystem section. */
export async function GET(req: NextRequest) {
  const blocked = await limited(req, "collections", 60);
  if (blocked) return blocked;

  const registry = await getRegistry(getDbOrNull());
  const verified = [...registry.values()].filter((e) => e.verified);
  // Names the registry does not carry (env-configured entries) come from the contracts; a failure just leaves them unnamed.
  const missing = verified.filter((e) => !e.name).map((e) => e.address);
  const names = missing.length ? await getCollectionNames(getClient(INDEXER_CHAIN_ID), missing).catch(() => new Map<string, string | null>()) : new Map<string, string | null>();

  return NextResponse.json({ collections: verifiedCollections(registry, names) }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
