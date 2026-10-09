import { candidateUrls, canonicalUri, fetchImageStream, parseUri, type Deps, type ImageStream } from "./nft-resolver";
import { resolverOptions } from "./nft-types";

export const MAX_PROXY_URL_LENGTH = 2048;

export type ProxyResult =
  | { ok: true; stream: ImageStream; headers: Record<string, string> }
  | { ok: false; status: 400 | 502; error: string };

/**
 * The image proxy's brain (the route is a thin wrapper): turn an ipfs:// / ar:// / http(s) reference into a streamed image.
 *
 * Why a proxy at all: browsers cannot load plain-http images on an https page, many hosts block hotlinking, and the public
 * IPFS gateways are unreliable from browsers. Server-side we can try every gateway, skip the ones that refuse us, and let a
 * CDN cache the result. It is not an open relay: the target must pass the SSRF guard on every redirect hop, the response must
 * actually be an image (HTML/JSON notices are rejected), and the size is capped.
 */
export async function proxyImage(rawUrl: string | null, deps: Deps = {}): Promise<ProxyResult> {
  if (!rawUrl || rawUrl.length > MAX_PROXY_URL_LENGTH) return { ok: false, status: 400, error: "url is required (max 2048 characters)" };
  const parsed = parseUri(rawUrl);
  if (parsed.kind === "unsupported" || parsed.kind === "data") return { ok: false, status: 400, error: "url must be http(s)://, ipfs:// or ar://" };

  try {
    const stream = await fetchImageStream(candidateUrls(parsed, resolverOptions()), resolverOptions(), deps);
    // Content-addressed data never changes, so it can be cached forever; a plain URL might.
    const immutable = parsed.kind === "ipfs" || parsed.kind === "arweave" || (parsed.kind === "http" && !!parsed.ipfs);
    const headers: Record<string, string> = {
      "Content-Type": stream.contentType,
      "X-Content-Type-Options": "nosniff",
      // Even if someone navigates straight to this URL, an SVG cannot run script or load anything.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "Cross-Origin-Resource-Policy": "same-site",
      "Cache-Control": immutable ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
      "X-Image-Source": new URL(stream.sourceUrl).host,
    };
    if (stream.contentLength) headers["Content-Length"] = String(stream.contentLength);
    return { ok: true, stream, headers };
  } catch {
    // The detail (which gateway said what) is in the server logs of the resolver; callers only need to know to fall back.
    return { ok: false, status: 502, error: "image unavailable" };
  }
}

export const canonicalOf = (rawUrl: string) => canonicalUri(rawUrl);
