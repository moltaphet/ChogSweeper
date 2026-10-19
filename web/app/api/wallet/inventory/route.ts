import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { INDEXER_CHAIN_ID, UnsupportedChainError, supportedChainIds } from "@/lib/server/chains";
import { INVENTORY_TTL_SECONDS, getRedis, inventoryKey } from "@/lib/server/cache";
import { badRequest, limited, parseChainId } from "@/lib/server/http";
import type { WalletNFTs } from "@/lib/server/wallet";
import { getWalletNFTs } from "@/lib/server/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/wallet/inventory?address=0x…[&chainId=10143][&collection=chog|0x…][&collections=0x…,0x…]
 *
 * Every ERC-721 the wallet holds, with image, token id, name, traits and verified status.
 * `collection` filters the result; `collections` adds extra contracts to scan (max 10).
 * Served from Redis when warm; the indexer drops `inv:<wallet>` whenever a transfer touches the wallet.
 */
export async function GET(req: NextRequest) {
  const started = performance.now();
  const p = req.nextUrl.searchParams;
  const address = p.get("address") ?? "";
  const chainId = parseChainId(p.get("chainId"), INDEXER_CHAIN_ID);
  const collection = p.get("collection")?.toLowerCase() || undefined;
  const extra = (p.get("collections") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  if (!isAddress(address, { strict: false })) return badRequest("address must be a valid 0x address");
  if (!Number.isSafeInteger(chainId)) return badRequest("chainId must be an integer");
  if (!supportedChainIds().includes(chainId)) return badRequest(`chainId must be one of ${supportedChainIds().join(", ")}`);
  if (collection && collection !== "chog" && !isAddress(collection, { strict: false })) return badRequest("collection must be a 0x address or 'chog'");
  if (extra.length > 10 || extra.some((a) => !isAddress(a, { strict: false }))) return badRequest("collections must be up to 10 valid addresses");

  const blocked = await limited(req, "inventory", 60);
  if (blocked) return blocked;

  const redis = getRedis();
  const field = `${chainId}|${[...extra].sort().join(",")}`;
  let body: WalletNFTs | null = null;
  let cache: "hit" | "miss" | "bypass" = redis ? "miss" : "bypass";

  if (redis) {
    try {
      body = await redis.hget<WalletNFTs>(inventoryKey(address), field);
      if (body) cache = "hit";
    } catch {
      cache = "bypass";
    }
  }

  if (!body) {
    try {
      body = await getWalletNFTs(address, chainId, { extraCollections: extra });
    } catch (e) {
      if (e instanceof UnsupportedChainError) return NextResponse.json({ error: `chainId must be one of ${supportedChainIds().join(", ")}` }, { status: 400 });
      console.error("wallet inventory failed", e);
      return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 });
    }
    if (redis && cache === "miss") {
      try {
        const pipe = redis.pipeline();
        pipe.hset(inventoryKey(address), { [field]: body });
        // Partial results are retried soon so a slow gateway or RPC does not stick for two minutes.
        pipe.expire(inventoryKey(address), body.partial ? 15 : INVENTORY_TTL_SECONDS);
        await pipe.exec();
      } catch { /* serve uncached */ }
    }
  }

  const items = !collection
    ? body.items
    : body.items.filter((i) => (collection === "chog" ? i.isChog : i.contract.toLowerCase() === collection));

  return NextResponse.json(
    { ...body, items, count: items.length },
    {
      headers: {
        "Cache-Control": body.partial ? "no-store" : "public, s-maxage=5, stale-while-revalidate=30",
        "X-Cache": cache,
        "Server-Timing": `total;dur=${(performance.now() - started).toFixed(1)}`,
      },
    },
  );
}
