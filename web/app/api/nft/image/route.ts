import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { INDEXER_CHAIN_ID, getClient } from "@/lib/server/chains";
import { badRequest, isTokenId, limited } from "@/lib/server/http";
import { proxyImage } from "@/lib/server/image-proxy";
import { decodeDataUri } from "@/lib/server/nft-resolver";
import { getTokenMetadata } from "@/lib/server/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/nft/image?url=<ipfs://… | ar://… | https://… | http://…>
 *   Streams a remote image through the server: tries every IPFS/Arweave gateway, bypasses CORS, hotlink blocks and
 *   mixed-content, and is CDN-cacheable. Only real images are served, size-capped, SSRF-guarded.
 *
 * GET /api/nft/image?contract=0x…&tokenId=1
 *   Serves a fully on-chain (data:) image as a real image response, so large SVGs are not inlined into JSON lists.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const blocked = await limited(req, "image", 600);
  if (blocked) return blocked;

  // ---- remote image proxy -------------------------------------------------------------------------------------
  if (p.has("url")) {
    const result = await proxyImage(p.get("url"));
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status, headers: { "Cache-Control": "public, max-age=10" } });
    }
    // Stream straight through: the image is never buffered in memory.
    return new NextResponse(result.stream.body, { headers: result.headers });
  }

  // ---- on-chain (data:) image ---------------------------------------------------------------------------------
  const contract = (p.get("contract") ?? "").toLowerCase();
  const tokenId = p.get("tokenId") ?? "";
  if (!isAddress(contract, { strict: false })) return badRequest("pass url=…, or contract=0x…&tokenId=…");
  if (!isTokenId(tokenId)) return badRequest("tokenId must be a non-negative integer");

  const meta = await getTokenMetadata(getClient(INDEXER_CHAIN_ID), INDEXER_CHAIN_ID, contract, tokenId);
  const decoded = meta.imageUri?.startsWith("data:") ? decodeDataUri(meta.imageUri) : null;
  if (!decoded) return NextResponse.json({ error: "no on-chain image for this token" }, { status: 404 });

  return new NextResponse(new Uint8Array(decoded.bytes), {
    headers: {
      "Content-Type": decoded.mime,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
