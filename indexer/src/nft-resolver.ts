/**
 * Universal NFT metadata resolver: URI parsing (ipfs / ar / data / http), SSRF-safe fetching with gateway
 * fallback, and tolerant metadata parsing. Pure and dependency-free (node built-ins only) so the exact same
 * code runs in the Next.js API routes and in the indexer worker.
 *
 * CANONICAL SOURCE. `indexer/src/nft-resolver.ts` and `web/lib/server/nft-resolver.ts` are copies made by
 * `node scripts/sync-shared.mjs`; a test fails if they drift. Edit this file only.
 */
import dns from "node:dns/promises";
import net from "node:net";

// ---------------------------------------------------------------------------------------------- config

/**
 * Public IPFS gateways, in preference order. The big Protocol Labs gateways (ipfs.io, dweb.link, w3s.link) now answer
 * plain HTTP requests with `429 "switching to a service worker gateway only"`, so they only work for some callers; Pinata
 * and 4everland still serve normally. Resolution does not depend on the order: gateways that fail are demoted at runtime
 * (see `orderByHealth`) and a slow one is hedged by the next. Cloudflare's gateway was retired and is not listed.
 * For production traffic set IPFS_GATEWAYS to a dedicated gateway.
 */
export const DEFAULT_IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://4everland.io/ipfs/",
  "https://w3s.link/ipfs/",
];
export const DEFAULT_ARWEAVE_GATEWAYS = ["https://arweave.net/", "https://ar-io.net/"];

export interface ResolverOptions {
  ipfsGateways: string[];
  arweaveGateways: string[];
  /** Per-attempt timeout (to response headers for images; to the full body for JSON). Public gateways can be slow cold. */
  timeoutMs: number;
  /** Start the next gateway if the current one has not answered after this long. */
  hedgeMs: number;
  maxJsonBytes: number;
  maxImageBytes: number;
  maxRedirects: number;
}

export const DEFAULT_OPTIONS: ResolverOptions = {
  ipfsGateways: DEFAULT_IPFS_GATEWAYS,
  arweaveGateways: DEFAULT_ARWEAVE_GATEWAYS,
  timeoutMs: 10_000,
  hedgeMs: 1_500,
  maxJsonBytes: 1_000_000,
  maxImageBytes: 12_000_000,
  maxRedirects: 3,
};

/** Injection points so the network layer is testable without sockets. */
export interface Deps {
  fetch?: typeof fetch;
  lookup?: (host: string) => Promise<Array<{ address: string }>>;
}

export function withGateways(gateways: string | undefined, base: ResolverOptions = DEFAULT_OPTIONS): ResolverOptions {
  const list = (gateways ?? "").split(",").map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
  return list.length ? { ...base, ipfsGateways: list.map((g) => g.replace(/\/?$/, "/")) } : base;
}

// ---------------------------------------------------------------------------------------------- URIs

const CID_V0 = "Qm[1-9A-HJ-NP-Za-km-z]{44}";
const CID_V1 = "b[a-z2-7]{58,}";
const CID = `(?:${CID_V0}|${CID_V1})`;
const RE_PATH_CID = new RegExp(`^/ipfs/(${CID})(/.*)?$`);
const RE_SUBDOMAIN_CID = new RegExp(`^(${CID})\\.ipfs\\.`, "i");
const RE_BARE_CID = new RegExp(`^(${CID})(/.*)?$`);
const RE_AR_ID = /^[A-Za-z0-9_-]{43}$/;

export type ParsedUri =
  | { kind: "ipfs"; cid: string; path: string }
  | { kind: "arweave"; id: string; path: string }
  | { kind: "http"; url: string; ipfs?: { cid: string; path: string } }
  | { kind: "data"; uri: string }
  | { kind: "unsupported" };

export function parseUri(input: string | null | undefined): ParsedUri {
  const u = (input ?? "").trim();
  if (!u) return { kind: "unsupported" };

  if (/^ipfs:\/\//i.test(u)) {
    const rest = u.slice(7).replace(/^ipfs\//i, "");
    const m = RE_BARE_CID.exec(rest);
    return m ? { kind: "ipfs", cid: m[1]!, path: m[2] ?? "" } : { kind: "unsupported" };
  }
  if (/^ar:\/\//i.test(u)) {
    const [id = "", ...tail] = u.slice(5).split("/");
    return RE_AR_ID.test(id) ? { kind: "arweave", id, path: tail.length ? "/" + tail.join("/") : "" } : { kind: "unsupported" };
  }
  if (/^data:/i.test(u)) return { kind: "data", uri: u };
  if (/^https?:\/\//i.test(u)) {
    try {
      const url = new URL(u);
      // A pinned gateway URL can still be re-served from other gateways if it carries a CID.
      const p = RE_PATH_CID.exec(url.pathname);
      if (p) return { kind: "http", url: u, ipfs: { cid: p[1]!, path: (p[2] ?? "") + url.search } };
      const s = RE_SUBDOMAIN_CID.exec(url.hostname);
      if (s) return { kind: "http", url: u, ipfs: { cid: s[1]!, path: (url.pathname === "/" ? "" : url.pathname) + url.search } };
      return { kind: "http", url: u };
    } catch {
      return { kind: "unsupported" };
    }
  }
  const bare = RE_BARE_CID.exec(u);
  return bare ? { kind: "ipfs", cid: bare[1]!, path: bare[2] ?? "" } : { kind: "unsupported" };
}

/** Ordered list of http(s) URLs that can serve this resource. Empty for data / unsupported URIs. */
export function candidateUrls(p: ParsedUri, o: Pick<ResolverOptions, "ipfsGateways" | "arweaveGateways"> = DEFAULT_OPTIONS): string[] {
  switch (p.kind) {
    case "ipfs":
      return o.ipfsGateways.map((g) => `${g}${p.cid}${p.path}`);
    case "arweave":
      return o.arweaveGateways.map((g) => `${g}${p.id}${p.path}`);
    case "http": {
      const alternates = p.ipfs ? o.ipfsGateways.map((g) => `${g}${p.ipfs!.cid}${p.ipfs!.path}`).filter((x) => x !== p.url) : [];
      return [p.url, ...alternates];
    }
    default:
      return [];
  }
}

/** Gateway-independent form that is stored in the database: ipfs://cid/path, ar://id/path, https URL or data URI. */
export function canonicalUri(input: string | null | undefined): string | null {
  const p = parseUri(input);
  switch (p.kind) {
    case "ipfs":
      return `ipfs://${p.cid}${p.path}`;
    case "arweave":
      return `ar://${p.id}${p.path}`;
    case "http":
      return p.ipfs ? `ipfs://${p.ipfs.cid}${p.ipfs.path}` : p.url;
    case "data":
      return p.uri;
    default:
      return null;
  }
}

/** First usable http URL for a URI (kept for callers that need one link). */
export function normalizeUri(uri: string | null | undefined, o: Pick<ResolverOptions, "ipfsGateways" | "arweaveGateways"> = DEFAULT_OPTIONS): string | null {
  const p = parseUri(uri);
  if (p.kind === "data") return p.uri;
  return candidateUrls(p, o)[0] ?? null;
}

/** ERC-1155 style `{id}` placeholder: lowercase hex, zero padded to 64 chars. */
export function expandTokenUriTemplate(uri: string, tokenId: bigint): string {
  return uri.includes("{id}") ? uri.replaceAll("{id}", tokenId.toString(16).padStart(64, "0")) : uri;
}

// ---------------------------------------------------------------------------------------------- data URIs

const MAX_DATA_URI_CHARS = 2_000_000;

export function decodeDataUri(uri: string): { mime: string; bytes: Buffer } | null {
  if (uri.length > MAX_DATA_URI_CHARS) return null;
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  const header = uri.slice(5, comma); // after "data:"
  const payload = uri.slice(comma + 1);
  const [mimeRaw = "", ...params] = header.split(";");
  const mime = (mimeRaw || "text/plain").toLowerCase();
  if (params.some((p) => p.toLowerCase() === "base64")) {
    return { mime, bytes: Buffer.from(payload, "base64") };
  }
  try {
    return { mime, bytes: Buffer.from(decodeURIComponent(payload), "utf8") };
  } catch {
    // Raw JSON/SVG with a stray "%" (e.g. "100%"): use it literally.
    return { mime, bytes: Buffer.from(payload, "utf8") };
  }
}

export function decodeDataJson(uri: string, maxBytes = DEFAULT_OPTIONS.maxJsonBytes): unknown {
  const d = decodeDataUri(uri);
  if (!d || d.bytes.length > maxBytes) throw new Error("data uri too large or malformed");
  return JSON.parse(d.bytes.toString("utf8"));
}

const SAFE_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif", "image/svg+xml"]);

/**
 * Accepts only raster/SVG image data URIs and always re-encodes to base64 (raw SVG text containing `#`
 * or `%` breaks when used as a URL). SVG is safe here because it is only ever displayed through <img>,
 * which never runs scripts.
 */
export function sanitizeImageDataUri(uri: string): string | null {
  const d = decodeDataUri(uri);
  if (!d || !SAFE_IMAGE_MIME.has(d.mime) || d.bytes.length === 0) return null;
  return `data:${d.mime};base64,${d.bytes.toString("base64")}`;
}

/** Everything the UI can try, in order, for an image reference. A data URI is its own and only candidate. */
export function imageCandidates(imageUri: string | null | undefined, o: Pick<ResolverOptions, "ipfsGateways" | "arweaveGateways"> = DEFAULT_OPTIONS): string[] {
  if (!imageUri) return [];
  const p = parseUri(imageUri);
  if (p.kind === "data") return [p.uri];
  return candidateUrls(p, o);
}

// ---------------------------------------------------------------------------------------------- SSRF guard

/** Expands an IPv6 literal into 8 hextets, or null if it is not valid. Handles "::" and embedded dotted IPv4. */
function parseIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const o = dotted[1]!.split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, dotted.index) + ((o[0]! << 8) | o[1]!).toString(16) + ":" + ((o[2]! << 8) | o[3]!).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if ((halves.length === 1 && fill !== 0) || fill < 0) return null;
  const parts = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}

function isPrivateIpv4(a: number, b: number, c: number): boolean {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number) as [number, number, number];
    return isPrivateIpv4(a, b, c);
  }
  const h = parseIPv6(ip);
  if (!h) return true; // anything we cannot parse is treated as unsafe
  const [h0, h1, h2, h3, h4, h5, h6, h7] = h as [number, number, number, number, number, number, number, number];
  const embeddedV4 = () => isPrivateIpv4(h6 >> 8, h6 & 255, h7 >> 8);
  if (h.every((x) => x === 0) || (h.slice(0, 7).every((x) => x === 0) && h7 === 1)) return true; // :: and ::1
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && (h5 === 0xffff || h5 === 0)) return embeddedV4(); // v4-mapped / v4-compatible
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) return embeddedV4(); // NAT64
  return (h0 & 0xfe00) === 0xfc00 || (h0 & 0xffc0) === 0xfe80 || (h0 & 0xff00) === 0xff00; // ULA, link-local, multicast
}

/**
 * tokenURI is attacker-controlled (any collection deployer chooses it), so the resolver must not be usable to
 * reach internal services. Rejects non-http(s) URLs and hosts that are, or resolve to, non-public addresses.
 * Re-checked on every redirect hop. A DNS-rebinding race remains; run this where internal hosts are unreachable.
 */
export async function assertPublicHttpUrl(raw: string, lookup: Deps["lookup"] = (h) => dns.lookup(h, { all: true })): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
  if (url.username || url.password) throw new Error("credentials in url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("private host");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host);
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new Error("private address");
  return url;
}

// ---------------------------------------------------------------------------------------------- gateway health

/**
 * A gateway that answered with 429/403/5xx (or an HTML notice instead of content) is moved to the back of the line for a
 * while, so the next lookup does not waste its first attempt on a host that is known to be refusing us. This is
 * per-process state: cheap, self-healing, and enough to keep a dead gateway out of the hot path.
 */
const penalties = new Map<string, number>();
const SEVERE_MS = 10 * 60_000;
const MILD_MS = 60_000;

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export class HttpError extends Error {
  constructor(public readonly status: number, message?: string) {
    super(message ?? `http ${status}`);
  }
}

function recordFailure(url: string, err: unknown) {
  const status = err instanceof HttpError ? err.status : 0;
  const severe = status === 429 || status === 403 || status === 401 || status === 451 || status >= 500 || (err instanceof Error && /unexpected content|not json|not an image/i.test(err.message));
  const timeout = err instanceof Error && /timeout|abort|fetch failed|ECONN|ENOTFOUND/i.test(err.message + err.name);
  if (status === 404) return; // content simply is not there; the gateway itself is fine
  if (severe || timeout) penalties.set(hostOf(url), Date.now() + (severe ? SEVERE_MS : MILD_MS));
}
const recordSuccess = (url: string) => void penalties.delete(hostOf(url));

/** Healthy hosts first, previously failing hosts last; otherwise the original order is kept. */
export function orderByHealth(urls: string[], now = Date.now()): string[] {
  const bad = (u: string) => (penalties.get(hostOf(u)) ?? 0) > now;
  return [...urls.filter((u) => !bad(u)), ...urls.filter(bad)];
}
export const resetGatewayHealth = () => penalties.clear();

// ---------------------------------------------------------------------------------------------- fetching

async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  if (Number(res.headers.get("content-length") ?? 0) > max) throw new Error("response too large");
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > max) throw new Error("response too large");
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error("response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * One URL, following redirects by hand so that every hop passes the SSRF guard. The timeout covers the time until
 * response headers arrive; callers that stream a body manage the rest themselves.
 */
async function requestFollowing(url: string, o: ResolverOptions, deps: Deps, signal: AbortSignal, accept: string): Promise<Response> {
  const f = deps.fetch ?? fetch;
  let current = url;
  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    const target = await assertPublicHttpUrl(current, deps.lookup);
    const res = await f(target, { redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(o.timeoutMs)]), headers: { accept } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new HttpError(res.status, `redirect without location (${res.status})`);
      current = new URL(loc, target).toString();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new HttpError(res.status);
    }
    return res;
  }
  throw new Error("too many redirects");
}

/**
 * Runs `run` against the candidates, hedged: the next candidate starts when one fails, or after `hedgeMs` of silence.
 * The first success wins and every OTHER attempt is aborted (the winner is left alone, because it may still be streaming).
 * Candidates are tried healthiest-first. Fails only if every candidate fails.
 */
export function hedged<T>(
  candidates: string[],
  run: (url: string, signal: AbortSignal) => Promise<T>,
  o: Pick<ResolverOptions, "hedgeMs">,
): Promise<T> {
  const urls = orderByHealth(candidates);
  if (urls.length === 0) return Promise.reject(new Error("no candidate urls"));
  return new Promise<T>((resolve, reject) => {
    const controllers: AbortController[] = [];
    const errors: string[] = [];
    let started = 0;
    let failed = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (winner: number | null, fn: () => void) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      controllers.forEach((c, i) => i !== winner && c.abort());
      fn();
    };

    const startNext = () => {
      if (done || started >= urls.length) return;
      const idx = started++;
      const ctrl = new AbortController();
      controllers.push(ctrl);
      const url = urls[idx]!;
      run(url, ctrl.signal).then(
        (value) => {
          recordSuccess(url);
          finish(idx, () => resolve(value));
        },
        (e) => {
          if (done) return;
          recordFailure(url, e);
          errors.push(`${hostOf(url)}: ${e instanceof Error ? e.message : String(e)}`);
          failed++;
          if (failed === urls.length) finish(null, () => reject(new Error(`all gateways failed (${errors.join("; ")})`)));
          else startNext(); // fail fast: do not wait for the hedge timer when an attempt errors
        },
      );
      if (started < urls.length) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(startNext, o.hedgeMs);
      }
    };
    startNext();
  });
}

/**
 * Fetches bytes from the first candidate that both answers AND passes `validate`. A gateway that returns 200 with an
 * HTML notice instead of content fails validation and the next gateway is tried, instead of winning the race and
 * then breaking the caller.
 */
export function fetchFirstSuccess(urls: string[], o: ResolverOptions = DEFAULT_OPTIONS, deps: Deps = {}, validate?: (bytes: Uint8Array) => void): Promise<Uint8Array> {
  return hedged(
    urls,
    async (url, signal) => {
      const res = await requestFollowing(url, o, deps, signal, "application/json, */*;q=0.5");
      const bytes = await readLimited(res, o.maxJsonBytes);
      validate?.(bytes);
      return bytes;
    },
    o,
  );
}

/** Fetches and parses the metadata JSON for any supported URI form. */
export async function fetchMetadataJson(uri: string, o: ResolverOptions = DEFAULT_OPTIONS, deps: Deps = {}): Promise<unknown> {
  const trimmed = uri.trim();
  // Some contracts return the JSON itself instead of a pointer to it.
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);

  const p = parseUri(trimmed);
  if (p.kind === "data") return decodeDataJson(p.uri, o.maxJsonBytes);
  if (p.kind === "unsupported") throw new Error("unsupported tokenURI");

  let parsed: unknown;
  await fetchFirstSuccess(candidateUrls(p, o), o, deps, (bytes) => {
    let v: unknown;
    try {
      v = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("unexpected content (not JSON)");
    }
    if (!v || typeof v !== "object") throw new Error("unexpected content (not a JSON object)");
    parsed = v;
  });
  return parsed;
}

// ---------------------------------------------------------------------------------------------- images

export const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif", "image/svg+xml", "image/bmp", "image/apng"]);

/** Identify an image by its first bytes, for gateways that serve images as octet-stream / text/plain. */
export function sniffImageMime(b: Uint8Array): string | null {
  const at = (i: number) => b[i] ?? 0;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  if (at(0) === 0x42 && at(1) === 0x4d) return "image/bmp";
  const ascii = (from: number, len: number) => String.fromCharCode(...Array.from(b.slice(from, from + len)));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(4, 4) === "ftyp" && /^avi[fs]$/.test(ascii(8, 4))) return "image/avif";
  const head = new TextDecoder().decode(b.slice(0, 600)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

export interface ImageStream {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
  sourceUrl: string;
}

/** Wraps a reader (with an already-read first chunk) in a stream that errors out if more than `max` bytes flow through. */
function limitedStream(first: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let sent = 0;
  let primed = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!primed) {
        primed = true;
        sent += first.length;
        controller.enqueue(first);
        return;
      }
      const { done, value } = await reader.read();
      if (done) return controller.close();
      sent += value.length;
      if (sent > max) {
        await reader.cancel().catch(() => {});
        return controller.error(new Error("image too large"));
      }
      controller.enqueue(value);
    },
    cancel: () => reader.cancel().catch(() => {}),
  });
}

/**
 * Finds the first candidate that serves a real image and returns it as a stream, without buffering it.
 * Checks: status, declared size, content type (allowlist; octet-stream/text-plain are sniffed from the bytes, and HTML or
 * JSON notices are rejected so the next gateway is tried), and a hard byte cap while streaming.
 */
export function fetchImageStream(urls: string[], o: ResolverOptions = DEFAULT_OPTIONS, deps: Deps = {}): Promise<ImageStream> {
  return hedged(
    urls,
    async (url, signal) => {
      const res = await requestFollowing(url, o, deps, signal, "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5");
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > o.maxImageBytes) {
        await res.body?.cancel().catch(() => {});
        throw new Error("image too large");
      }
      if (!res.body) throw new Error("not an image (empty body)");

      const reader = res.body.getReader();
      const first = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout waiting for image bytes")), o.timeoutMs)),
      ]);
      if (first.done || !first.value?.length) throw new Error("not an image (empty body)");
      // The first chunk counts toward the cap too: a server may send everything in one piece.
      if (first.value.length > o.maxImageBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("image too large");
      }

      const header = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      const sniffed = sniffImageMime(first.value);
      // A declared image type must be believable; an unhelpful type is replaced by what the bytes say; anything else is not an image.
      const contentType = IMAGE_MIME.has(header) ? header : sniffed;
      if (!contentType || (IMAGE_MIME.has(header) && header !== "image/svg+xml" && sniffed === null && /^\s*</.test(new TextDecoder().decode(first.value.slice(0, 16))))) {
        await reader.cancel().catch(() => {});
        throw new Error(`not an image (${header || "no content-type"})`);
      }
      return { body: limitedStream(first.value, reader, o.maxImageBytes), contentType, contentLength: declared > 0 ? declared : null, sourceUrl: url };
    },
    o,
  );
}

// ---------------------------------------------------------------------------------------------- parsing

export interface Trait {
  trait_type: string;
  value: string;
}

export interface ParsedMetadata {
  name: string | null;
  description: string | null;
  /** Canonical, gateway-independent image reference (see `canonicalUri`). */
  imageUri: string | null;
  /** Canonical animation_url (video/audio/3D/html); informational, the UI only shows still images. */
  animationUri: string | null;
  attributes: Trait[];
}

const clip = (v: unknown, n: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const isPrimitive = (v: unknown): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v);
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const NON_IMAGE_EXT = /\.(mp4|webm|mov|m4v|mp3|wav|ogg|flac|glb|gltf|html?|pdf)(\?.*)?$/i;

/**
 * Resolves a reference that is relative to the metadata file ("1.png", "../img/1.png", "/img/1.png"), which some
 * collections use. Bare CIDs, URIs with a scheme and protocol-relative URLs are left to the normal paths.
 */
export function resolveRelative(ref: string, base: string | null | undefined): string | null {
  const r = ref.trim();
  if (!r || HAS_SCHEME.test(r) || parseUri(r).kind !== "unsupported") return null;
  if (r.startsWith("//")) return `https:${r}`;
  const b = parseUri(base);
  if (b.kind === "ipfs") {
    const dir = b.path.includes("/") ? b.path.slice(0, b.path.lastIndexOf("/") + 1) : "/";
    const joined = new URL(r, `http://x${dir.startsWith("/") ? dir : "/" + dir}`).pathname;
    return `ipfs://${b.cid}${joined}`;
  }
  if (b.kind === "http") {
    try {
      return new URL(r, b.url).toString();
    } catch {
      return null;
    }
  }
  if (b.kind === "arweave") return `ar://${b.id}${new URL(r, `http://x${b.path || "/"}`).pathname}`;
  return null;
}

/**
 * Tolerant metadata parser. `baseUri` is where the JSON itself came from, used for relative image paths.
 * Image precedence: image, image_url, imageUrl, imageURI, inline image_data, then animation_url when it looks like a still image.
 */
export function parseMetadata(json: unknown, baseUri?: string | null): ParsedMetadata {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, any>;

  const toImageUri = (raw: unknown): string | null => {
    if (typeof raw !== "string" || !raw.trim()) return null;
    const c = canonicalUri(raw) ?? canonicalUri(resolveRelative(raw, baseUri));
    return c && c.startsWith("data:") ? sanitizeImageDataUri(c) : c;
  };

  let imageUri: string | null = null;
  for (const key of ["image", "image_url", "imageUrl", "imageURI", "image_uri"]) {
    imageUri = toImageUri(j[key]);
    if (imageUri) break;
  }
  if (!imageUri && j.properties && typeof j.properties === "object") imageUri = toImageUri((j.properties as Record<string, any>).image);
  if (!imageUri && typeof j.image_data === "string") {
    const raw = j.image_data.trim();
    if (raw.startsWith("<svg") || raw.startsWith("<?xml")) imageUri = sanitizeImageDataUri(`data:image/svg+xml;base64,${Buffer.from(raw, "utf8").toString("base64")}`);
    else if (raw.startsWith("data:")) imageUri = sanitizeImageDataUri(raw);
  }

  const animationUri = typeof j.animation_url === "string" ? canonicalUri(j.animation_url) ?? canonicalUri(resolveRelative(j.animation_url, baseUri)) : null;
  // Last resort: an animation_url that is not obviously video/audio/3D may still be a picture (the image proxy decides).
  if (!imageUri && animationUri && !animationUri.startsWith("data:") && !NON_IMAGE_EXT.test(animationUri)) imageUri = animationUri;

  const traits: Trait[] = [];
  const push = (type: unknown, value: unknown) => {
    if (traits.length >= 64 || typeof type !== "string" || !type.trim() || !isPrimitive(value)) return;
    traits.push({ trait_type: type.trim().slice(0, 100), value: String(value).slice(0, 200) });
  };
  const list = Array.isArray(j.attributes) ? j.attributes : Array.isArray(j.traits) ? j.traits : null;
  if (list) {
    for (const a of list) push(a?.trait_type ?? a?.type ?? a?.name, a?.value);
  } else {
    // Map form: { "Hat": "Red" } under attributes or properties
    const map = [j.attributes, j.properties].find((m) => m && typeof m === "object" && !Array.isArray(m));
    if (map) for (const [k, v] of Object.entries(map as Record<string, unknown>)) push(k, v);
  }

  return { name: clip(j.name, 200), description: clip(j.description, 2000), imageUri, animationUri, attributes: traits };
}
