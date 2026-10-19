import { NextResponse, type NextRequest } from "next/server";
import { isAddress, type Address } from "viem";
import { nftReadAbi } from "@/lib/server/abi";
import { INDEXER_CHAIN_ID, UnsupportedChainError, getClient, supportedChainIds } from "@/lib/server/chains";
import { getDbOrNull } from "@/lib/server/db";
import { badRequest, isTokenId, limited, parseChainId } from "@/lib/server/http";
import { buildApiNft } from "@/lib/server/nft-types";
import { getRegistry } from "@/lib/server/registry";
import { getCollectionNames, getTokenMetadata, isDeterministicFailure, readTokenUri } from "@/lib/server/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/nft/resolve?contract=0x…&tokenId=123[&chainId=10143]
 *
 * Resolves any single token: `tokenURI(id)` (or `uri(id)` for ERC-1155-style contracts) with a 6s timeout and retries, then
 * the metadata over ipfs / ar / data / http with gateway fallback. `image` is what the UI should load (ipfs:// and ar://
 * images come back as our image-proxy URL, with direct gateway URLs in `imageFallbacks`); `imageGatewayUrl` is the same
 * image as a plain http(s) gateway URL. Reports the current owner. This is what "add a token manually" uses.
 *
 * The token is always returned when it exists, even if its metadata could not be fetched (`meta: "unresolved"`), so the
 * UI can still offer it with a fallback thumbnail. `tradeable` is false for tokens that are not ERC-721 (ChogSweeper
 * escrows ERC-721 only).
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const contract = (p.get("contract") ?? "").toLowerCase();
  const tokenId = p.get("tokenId") ?? "";
  const chainId = parseChainId(p.get("chainId"), INDEXER_CHAIN_ID);

  if (!isAddress(contract, { strict: false })) return badRequest("contract must be a valid 0x address");
  if (!isTokenId(tokenId)) return badRequest("tokenId must be a non-negative integer (uint256)");
  if (!Number.isInteger(chainId)) return badRequest("chainId must be an integer");

  const blocked = await limited(req, "resolve", 30);
  if (blocked) return blocked;

  try {
    const client = getClient(chainId);

    // 1. Is there a contract, and is this an existing ERC-721 token? ownerOf is the cheapest reliable test.
    const code = await client.getCode({ address: contract as Address });
    if (!code || code === "0x") return NextResponse.json({ error: "no contract at this address on this chain" }, { status: 404 });

    let owner: string | null;
    let standard: "erc721" | "erc1155" = "erc721";
    try {
      owner = (await client.readContract({ address: contract as Address, abi: nftReadAbi, functionName: "ownerOf", args: [BigInt(tokenId)] })).toLowerCase();
    } catch (e) {
      if (!isDeterministicFailure(e)) throw e; // a flaky RPC is a 503, not "this token does not exist"
      // Not an ERC-721 token. A contract that answers `uri(id)` is ERC-1155 style: show it, but it cannot be traded here.
      let hasUri = false;
      try {
        hasUri = !!(await readTokenUri(client, contract as Address, BigInt(tokenId))).uri;
      } catch { /* neither: handled below */ }
      if (!hasUri) return NextResponse.json({ error: "token does not exist, or the contract is not an ERC-721" }, { status: 404 });
      owner = null;
      standard = "erc1155";
    }

    // 2. Metadata through the layered cache (memory, Redis, database, chain + gateways).
    const [meta, registry, names] = await Promise.all([
      getTokenMetadata(client, chainId, contract, tokenId),
      getRegistry(chainId === INDEXER_CHAIN_ID ? getDbOrNull() : null, chainId),
      getCollectionNames(client, [contract]),
    ]);
    const entry = registry.get(contract);

    const nft = buildApiNft({
      contract, tokenId, chainId, name: meta.name, description: meta.description, imageUri: meta.imageUri, traits: meta.traits,
      meta: meta.state === "ok" ? "ok" : "unresolved", collection: entry, collectionName: entry?.name ?? names.get(contract) ?? null,
    });

    const tradeable = standard === "erc721";
    return NextResponse.json(
      {
        ...nft, owner, chainId, standard, tradeable,
        imageUri: meta.imageUri, tokenUri: meta.tokenUri, source: meta.source,
        error: tradeable ? (meta.error ?? null) : "This is an ERC-1155 style token. ChogSweeper trades ERC-721 NFTs only.",
      },
      // Owner can change at any time, so keep shared caching short; the metadata itself is cached server-side.
      { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=60" } },
    );
  } catch (e) {
    if (e instanceof UnsupportedChainError) return NextResponse.json({ error: `chainId must be one of ${supportedChainIds().join(", ")}` }, { status: 400 });
    console.error("nft resolve failed", e);
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 });
  }
}
