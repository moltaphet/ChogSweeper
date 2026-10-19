import { DEFAULT_OPTIONS, candidateUrls, canonicalUri, parseUri, withGateways, type ResolverOptions, type Trait } from "./nft-resolver";
import type { RegistryEntry } from "./registry";

export type { Trait };

/** How complete the metadata for a token is. `unresolved` = tokenURI/gateways failed; show the fallback thumbnail. */
export type MetaState = "ok" | "pending" | "unresolved";

/** API shape shared by /api/wallet/inventory and /api/nft/resolve. Mirrors the frontend `NFTItem`. */
export interface ApiNft {
  contract: string;
  tokenId: string;
  name: string;
  description: string | null;
  collectionName: string;
  /** Best image URL, or null when none exists. Large on-chain images are served from /api/nft/image. */
  image: string | null;
  /** Alternate URLs for the same image: the UI advances through them when one fails to load. */
  imageFallbacks: string[];
  /** The image as a plain http(s) gateway URL (ipfs:// and ar:// resolved), for clients that cannot use the proxy. null for on-chain images. */
  imageGatewayUrl: string | null;
  isChog: boolean;
  verified: boolean;
  ecosystem: "chog" | "monad" | null;
  traits: Trait[];
  meta: MetaState;
}

export const resolverOptions = (): ResolverOptions => withGateways(process.env.IPFS_GATEWAYS, DEFAULT_OPTIONS);

/** Data URIs above this are not inlined into JSON lists; they are served by /api/nft/image instead. */
const INLINE_DATA_URI_LIMIT = 8_000;

export const imageProxyUrl = (canonical: string) => `/api/nft/image?url=${encodeURIComponent(canonical)}`;

/** The first plain http(s) URL a browser could load directly for this image (a gateway URL for ipfs:// and ar://). */
export function gatewayUrl(imageUri: string | null): string | null {
  if (!imageUri || imageUri.startsWith("data:")) return null;
  return candidateUrls(parseUri(imageUri), resolverOptions())[0] ?? null;
}

/**
 * How the browser should try to load an image, in order:
 *  - ipfs:// and ar://   our image proxy first (it tries every gateway server-side, skips the ones that answer 429 today,
 *                        and is cached), then two direct gateway URLs in case the proxy itself is unavailable
 *  - https://            the URL itself, then the proxy (hotlink protection, flaky hosts)
 *  - http://             the proxy only: a browser blocks plain-http images on an https page (mixed content)
 *  - data: (small)       inline;  data: (large)  served from /api/nft/image so it is not embedded in JSON lists
 */
export function imageFields(imageUri: string | null, contract: string, tokenId: string, chainId?: number): { image: string | null; imageFallbacks: string[] } {
  if (!imageUri) return { image: null, imageFallbacks: [] };
  if (imageUri.startsWith("data:")) {
    return imageUri.length > INLINE_DATA_URI_LIMIT
      ? { image: `/api/nft/image?contract=${contract}&tokenId=${tokenId}${chainId === undefined ? "" : `&chainId=${chainId}`}`, imageFallbacks: [] }
      : { image: imageUri, imageFallbacks: [] };
  }
  const canonical = canonicalUri(imageUri) ?? imageUri;
  // A gateway URL that carries a CID (https://some.gateway/ipfs/<cid>/…) IS IPFS content: canonicalUri turned it into ipfs://,
  // so it is served like any other IPFS image instead of hammering that one gateway directly.
  const p = parseUri(canonical);
  const proxy = imageProxyUrl(canonical);
  if (p.kind === "ipfs" || p.kind === "arweave") return { image: proxy, imageFallbacks: candidateUrls(p, resolverOptions()).slice(0, 2) };
  if (p.kind === "http") return p.url.startsWith("https://") ? { image: p.url, imageFallbacks: [proxy] } : { image: proxy, imageFallbacks: [] };
  return { image: null, imageFallbacks: [] };
}

export function buildApiNft(input: {
  chainId?: number;
  contract: string;
  tokenId: string;
  name: string | null;
  description: string | null;
  imageUri: string | null;
  traits: Trait[];
  meta: MetaState;
  collection: RegistryEntry | undefined;
  collectionName: string | null;
}): ApiNft {
  const { contract, tokenId, collection } = input;
  const collectionName = input.collectionName ?? collection?.name ?? "Unknown collection";
  const { image, imageFallbacks } = imageFields(input.imageUri, contract, tokenId, input.chainId);
  return {
    contract, tokenId,
    name: input.name ?? `${collectionName} #${tokenId}`,
    description: input.description,
    collectionName, image, imageFallbacks, imageGatewayUrl: gatewayUrl(input.imageUri),
    isChog: collection?.isChog ?? false,
    verified: collection?.verified ?? false,
    ecosystem: collection?.ecosystem ?? null,
    traits: input.traits,
    meta: input.meta,
  };
}
