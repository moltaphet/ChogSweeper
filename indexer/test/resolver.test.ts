import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertPublicHttpUrl, candidateUrls, canonicalUri, decodeDataJson, DEFAULT_OPTIONS, expandTokenUriTemplate,
  fetchFirstSuccess, fetchImageStream, fetchMetadataJson, imageCandidates, orderByHealth, parseMetadata, parseUri, resetGatewayHealth, resolveRelative,
  sanitizeImageDataUri, sniffImageMime, type ResolverOptions,
} from "../src/nft-resolver.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const V0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const V1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const AR = "ZQ1xYsmSaTbVGQkwD5e7dqpw_0FprP9bWKCSbTW6qcM";
const PUBLIC = async () => [{ address: "93.184.216.34" }];
const opts = (o: Partial<ResolverOptions> = {}): ResolverOptions => ({ ...DEFAULT_OPTIONS, hedgeMs: 20, timeoutMs: 500, ...o });
const b64 = (s: string) => Buffer.from(s).toString("base64");
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });
// Gateway health is process-wide state; every test starts with all gateways trusted.
beforeEach(() => resetGatewayHealth());

describe("shared resolver copies", () => {
  it("indexer and web copies are identical to shared/nft-resolver.ts (run scripts/sync-shared.mjs)", () => {
    const canon = readFileSync(path.resolve(here, "../../shared/nft-resolver.ts"), "utf8");
    expect(readFileSync(path.resolve(here, "../src/nft-resolver.ts"), "utf8")).toBe(canon);
    expect(readFileSync(path.resolve(here, "../../web/lib/server/nft-resolver.ts"), "utf8")).toBe(canon);
  });
});

describe("parseUri / canonicalUri / candidateUrls", () => {
  it("ipfs:// in all spellings", () => {
    expect(parseUri(`ipfs://${V0}/1.json`)).toEqual({ kind: "ipfs", cid: V0, path: "/1.json" });
    expect(parseUri(`ipfs://ipfs/${V1}`)).toEqual({ kind: "ipfs", cid: V1, path: "" });
    expect(parseUri(`${V0}/7`)).toEqual({ kind: "ipfs", cid: V0, path: "/7" }); // bare CID
    expect(parseUri("ipfs://not-a-cid")).toEqual({ kind: "unsupported" });
  });

  it("builds one candidate per gateway, in order", () => {
    const urls = candidateUrls(parseUri(`ipfs://${V0}/a.json`), opts());
    expect(urls).toEqual(DEFAULT_OPTIONS.ipfsGateways.map((g) => `${g}${V0}/a.json`));
    expect(urls.length).toBeGreaterThanOrEqual(3);
  });

  it("re-serves a gateway URL from other gateways (path and subdomain forms)", () => {
    const path = candidateUrls(parseUri(`https://some-pinata.example/ipfs/${V0}/1.png`), opts());
    expect(path[0]).toBe(`https://some-pinata.example/ipfs/${V0}/1.png`);
    expect(path).toContain(`https://dweb.link/ipfs/${V0}/1.png`);
    const sub = parseUri(`https://${V1}.ipfs.dweb.link/meta/1.json`);
    expect(sub).toMatchObject({ kind: "http", ipfs: { cid: V1, path: "/meta/1.json" } });
    expect(canonicalUri(`https://${V1}.ipfs.dweb.link/meta/1.json`)).toBe(`ipfs://${V1}/meta/1.json`);
  });

  it("plain https is passed through untouched with no alternates", () => {
    expect(candidateUrls(parseUri("https://api.example.com/t/1"), opts())).toEqual(["https://api.example.com/t/1"]);
  });

  it("ar:// maps to arweave gateways", () => {
    expect(candidateUrls(parseUri(`ar://${AR}`), opts())[0]).toBe(`https://arweave.net/${AR}`);
    expect(parseUri("ar://short")).toEqual({ kind: "unsupported" });
  });

  it("rejects dangerous or unknown schemes", () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "ftp://x/y", "", "   "]) {
      expect(parseUri(bad)).toEqual({ kind: "unsupported" });
      expect(canonicalUri(bad)).toBeNull();
    }
  });

  it("expands the {id} placeholder to 64 hex chars", () => {
    expect(expandTokenUriTemplate("https://x/{id}.json", 255n)).toBe(`https://x/${"0".repeat(62)}ff.json`);
    expect(expandTokenUriTemplate("https://x/1.json", 5n)).toBe("https://x/1.json");
  });
});

describe("data URIs (no network)", () => {
  it("decodes base64, url-encoded and raw-utf8 JSON", () => {
    expect(decodeDataJson(`data:application/json;base64,${b64('{"name":"A"}')}`)).toEqual({ name: "A" });
    expect(decodeDataJson(`data:application/json,${encodeURIComponent('{"name":"B"}')}`)).toEqual({ name: "B" });
    expect(decodeDataJson('data:application/json;utf8,{"name":"100% C"}')).toEqual({ name: "100% C" }); // stray %
  });

  it("re-encodes on-chain SVG to base64 so '#' and '%' survive, and drops non-images", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#836EF9" width="10%"/></svg>`;
    const out = sanitizeImageDataUri(`data:image/svg+xml;utf8,${svg}`)!;
    expect(out.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(Buffer.from(out.split(",")[1]!, "base64").toString()).toBe(svg);
    expect(sanitizeImageDataUri(`data:text/html;base64,${b64("<script>alert(1)</script>")}`)).toBeNull();
    expect(sanitizeImageDataUri("data:image/svg+xml;base64,")).toBeNull();
  });

  it("an oversized data URI is refused", () => {
    expect(sanitizeImageDataUri("data:image/png;base64," + "A".repeat(2_100_000))).toBeNull();
  });

  it("fetchMetadataJson reads data: tokenURIs without touching the network", async () => {
    const boom = async () => { throw new Error("network used"); };
    const out = await fetchMetadataJson(`data:application/json;base64,${b64('{"name":"On-chain"}')}`, opts(), { fetch: boom as any });
    expect(out).toEqual({ name: "On-chain" });
  });

  it("imageCandidates: a data image is its own only candidate; ipfs expands to all gateways", () => {
    const d = `data:image/png;base64,${b64("x")}`;
    expect(imageCandidates(d)).toEqual([d]);
    expect(imageCandidates(`ipfs://${V0}/i.png`, opts())).toHaveLength(DEFAULT_OPTIONS.ipfsGateways.length);
    expect(imageCandidates(null)).toEqual([]);
  });
});

describe("parseMetadata", () => {
  it("extracts name, description, image and standard attributes", () => {
    const m = parseMetadata({
      name: " Chog #7 ", description: "A chog", image: `ipfs://${V0}/7.png`,
      attributes: [{ trait_type: "Hat", value: "Red" }, { trait_type: "Level", value: 3, display_type: "number" }, { trait_type: 5 }, { value: "orphan" }],
    });
    expect(m).toEqual({
      name: "Chog #7", description: "A chog", imageUri: `ipfs://${V0}/7.png`,
      animationUri: null, attributes: [{ trait_type: "Hat", value: "Red" }, { trait_type: "Level", value: "3" }],
    });
  });

  it("accepts the alternate spellings and the map form of traits", () => {
    expect(parseMetadata({ image_url: "https://x/i.png", traits: [{ type: "Eyes", value: "Blue" }] })).toMatchObject({
      imageUri: "https://x/i.png", attributes: [{ trait_type: "Eyes", value: "Blue" }],
    });
    expect(parseMetadata({ properties: { Hat: "Red", Lvl: 2, nested: { a: 1 } } }).attributes).toEqual([
      { trait_type: "Hat", value: "Red" }, { trait_type: "Lvl", value: "2" },
    ]);
  });

  it("turns inline image_data SVG into a data URI and canonicalises gateway images", () => {
    expect(parseMetadata({ image_data: "<svg xmlns='http://www.w3.org/2000/svg'/>" }).imageUri).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(parseMetadata({ image: `https://ipfs.io/ipfs/${V0}/a.png` }).imageUri).toBe(`ipfs://${V0}/a.png`);
  });

  it("is safe on garbage input and caps trait count", () => {
    for (const bad of [null, undefined, 5, "x", [], { attributes: "nope" }]) {
      expect(parseMetadata(bad)).toEqual({ name: null, description: null, imageUri: null, animationUri: null, attributes: [] });
    }
    const many = Array.from({ length: 200 }, (_, i) => ({ trait_type: `t${i}`, value: i }));
    expect(parseMetadata({ attributes: many }).attributes).toHaveLength(64);
    expect(parseMetadata({ image: "javascript:alert(1)" }).imageUri).toBeNull();
    expect(parseMetadata({ image: `data:text/html;base64,${b64("<b>")}` }).imageUri).toBeNull();
  });
});

describe("SSRF guard", () => {
  it("blocks private, loopback, link-local, metadata and mapped addresses", async () => {
    const bad = [
      "http://127.0.0.1/x", "http://localhost/x", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "http://192.168.1.1/",
      "http://172.16.0.1/", "http://100.64.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://[fe80::1]/", "http://[64:ff9b::7f00:1]/", "http://[::127.0.0.1]/", "http://[::ffff:10.0.0.1]/", "http://[::ffff:a9fe:a9fe]/", "http://0.0.0.0/",
      "http://svc.internal/", "http://user:pw@example.com/", "ftp://example.com/x", "http://224.0.0.1/",
    ];
    for (const u of bad) await expect(assertPublicHttpUrl(u, PUBLIC)).rejects.toThrow();
  });

  it("blocks a public-looking hostname that resolves to a private address", async () => {
    await expect(assertPublicHttpUrl("https://rebind.example/x", async () => [{ address: "10.1.2.3" }])).rejects.toThrow("private");
    await expect(assertPublicHttpUrl("https://mixed.example/x", async () => [{ address: "8.8.8.8" }, { address: "127.0.0.1" }])).rejects.toThrow();
  });

  it("allows public IPv4 and IPv6 literals", async () => {
    for (const u of ["http://8.8.8.8/x", "http://[2606:4700:4700::1111]/x", "http://[::ffff:808:808]/x"]) {
      await expect(assertPublicHttpUrl(u, PUBLIC)).resolves.toBeInstanceOf(URL);
    }
  });

  it("allows an ordinary public host", async () => {
    await expect(assertPublicHttpUrl("https://example.com/x", PUBLIC)).resolves.toBeInstanceOf(URL);
  });
});

describe("gateway fallback fetching", () => {
  const urls = ["https://g1.example/ipfs/a", "https://g2.example/ipfs/a", "https://g3.example/ipfs/a"];
  const bytes = (b: Uint8Array) => new TextDecoder().decode(b);

  it("falls through failing gateways to the first working one", async () => {
    const seen: string[] = [];
    const fake = async (u: any) => {
      seen.push(String(u));
      if (String(u).includes("g1")) return new Response("boom", { status: 502 });
      if (String(u).includes("g2")) throw new Error("ECONNRESET");
      return json({ name: "ok" });
    };
    const out = await fetchFirstSuccess(urls, opts(), { fetch: fake as any, lookup: PUBLIC });
    expect(JSON.parse(bytes(out))).toEqual({ name: "ok" });
    expect(seen).toHaveLength(3);
  });

  it("does not wait for a hung gateway: the hedge starts the next one", async () => {
    const hang = (_u: any, init: any) => new Promise<Response>((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
    const fake = (u: any, init: any) => (String(u).includes("g1") ? hang(u, init) : Promise.resolve(json({ name: "fast" })));
    const t0 = Date.now();
    const out = await fetchFirstSuccess(urls, opts({ hedgeMs: 30, timeoutMs: 5_000 }), { fetch: fake as any, lookup: PUBLIC });
    expect(JSON.parse(bytes(out))).toEqual({ name: "fast" });
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("aborts the losing request once one succeeds", async () => {
    let aborted = false;
    const fake = (u: any, init: any) =>
      String(u).includes("g1")
        ? new Promise<Response>((_, rej) => init.signal.addEventListener("abort", () => { aborted = true; rej(new Error("aborted")); }))
        : Promise.resolve(json({ ok: 1 }));
    await fetchFirstSuccess(urls, opts({ hedgeMs: 10, timeoutMs: 5_000 }), { fetch: fake as any, lookup: PUBLIC });
    expect(aborted).toBe(true);
  });

  it("reports every gateway when all of them fail", async () => {
    const fake = async () => new Response("no", { status: 503 });
    await expect(fetchFirstSuccess(urls, opts(), { fetch: fake as any, lookup: PUBLIC })).rejects.toThrow(/all gateways failed.*g1\.example.*g3\.example/);
  });

  it("times out a slow gateway", async () => {
    const slow = (_u: any, init: any) => new Promise<Response>((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("timeout"))));
    await expect(fetchFirstSuccess([urls[0]!], opts({ timeoutMs: 40 }), { fetch: slow as any, lookup: PUBLIC })).rejects.toThrow();
  });

  it("follows redirects but re-checks every hop against the SSRF guard", async () => {
    const fake = async (u: any) =>
      String(u).includes("start")
        ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } })
        : json({ leaked: true });
    await expect(fetchFirstSuccess(["https://start.example/x"], opts(), { fetch: fake as any, lookup: PUBLIC })).rejects.toThrow(/private/);
  });

  it("follows a benign redirect (ipfs.io -> subdomain gateway)", async () => {
    const fake = async (u: any) =>
      String(u).includes("ipfs.io")
        ? new Response(null, { status: 301, headers: { location: `https://${V1}.ipfs.dweb.link/1.json` } })
        : json({ name: "redirected" });
    const out = await fetchFirstSuccess(["https://ipfs.io/ipfs/x"], opts(), { fetch: fake as any, lookup: PUBLIC });
    expect(JSON.parse(bytes(out))).toEqual({ name: "redirected" });
  });

  it("stops at the redirect limit", async () => {
    const fake = async () => new Response(null, { status: 302, headers: { location: "https://loop.example/x" } });
    await expect(fetchFirstSuccess(["https://loop.example/x"], opts({ maxRedirects: 2 }), { fetch: fake as any, lookup: PUBLIC })).rejects.toThrow(/redirects/);
  });

  it("refuses an oversized body (declared and streamed)", async () => {
    const declared = async () => new Response("{}", { status: 200, headers: { "content-length": "999999999" } });
    await expect(fetchFirstSuccess(["https://a.example/x"], opts({ maxJsonBytes: 1000 }), { fetch: declared as any, lookup: PUBLIC })).rejects.toThrow(/too large/);
    const streamed = async () => new Response("x".repeat(5000), { status: 200 });
    await expect(fetchFirstSuccess(["https://a.example/x"], opts({ maxJsonBytes: 1000 }), { fetch: streamed as any, lookup: PUBLIC })).rejects.toThrow(/too large/);
  });

  it("fetchMetadataJson end to end: ipfs:// tokenURI served by the second gateway", async () => {
    const fake = async (u: any) => (String(u).startsWith("https://ipfs.io") ? new Response("", { status: 504 }) : json({ name: "Chog #1", image: `ipfs://${V0}/1.png` }));
    const out = (await fetchMetadataJson(`ipfs://${V0}/1.json`, opts(), { fetch: fake as any, lookup: PUBLIC })) as any;
    expect(parseMetadata(out)).toMatchObject({ name: "Chog #1", imageUri: `ipfs://${V0}/1.png` });
  });
});


// =====================================================================================================================
// Real-world failure modes found while reproducing "images do not show for real collections"
// =====================================================================================================================

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const NOTICE = "This IPFS gateway is switching to a service worker gateway only.";

describe("default gateways (the big IPFS gateways answer 429 now)", () => {
  it("includes Pinata and 4everland, which still serve content, alongside ipfs.io and dweb.link", () => {
    const hosts = DEFAULT_OPTIONS.ipfsGateways.map((g) => new URL(g).host);
    expect(hosts).toEqual(expect.arrayContaining(["ipfs.io", "dweb.link", "gateway.pinata.cloud", "4everyland.io".replace("everyland", "everland")]));
    expect(hosts).not.toContain("cloudflare-ipfs.com"); // retired
  });

  it("recovers when the first gateways answer 429 with the 'service worker only' notice", async () => {
    const calls: string[] = [];
    const fake = async (u: any) => {
      calls.push(new URL(String(u)).host);
      return String(u).includes("pinata") ? json({ name: "Real", image: "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG" }) : new Response(NOTICE, { status: 429, headers: { "content-type": "text/plain" } });
    };
    const out = (await fetchMetadataJson(`ipfs://${V0}/1`, opts({ hedgeMs: 5 }), { fetch: fake as any, lookup: PUBLIC })) as any;
    expect(out.name).toBe("Real");
    expect(calls).toContain("ipfs.io");
    expect(calls).toContain("gateway.pinata.cloud");
  });

  it("a 200 that is an HTML/text notice is NOT accepted: it fails validation and the next gateway is tried", async () => {
    const fake = async (u: any) =>
      String(u).includes("ipfs.io") ? new Response(`<html>${NOTICE}</html>`, { status: 200, headers: { "content-type": "text/html" } }) : json({ name: "From the second gateway" });
    const out = (await fetchMetadataJson(`ipfs://${V0}/1`, opts({ hedgeMs: 5 }), { fetch: fake as any, lookup: PUBLIC })) as any;
    expect(out.name).toBe("From the second gateway");
  });

  it("remembers which gateways refuse us and tries healthy ones first next time", async () => {
    const urls = ["https://ipfs.io/ipfs/x", "https://dweb.link/ipfs/x", "https://gateway.pinata.cloud/ipfs/x"];
    const fake = async (u: any) => (String(u).includes("pinata") ? json({ ok: 1 }) : new Response(NOTICE, { status: 429 }));
    await fetchFirstSuccess(urls, opts({ hedgeMs: 5 }), { fetch: fake as any, lookup: PUBLIC });
    expect(orderByHealth(urls)).toEqual(["https://gateway.pinata.cloud/ipfs/x", "https://ipfs.io/ipfs/x", "https://dweb.link/ipfs/x"]);

    const seen: string[] = [];
    const spy = async (u: any) => (seen.push(new URL(String(u)).host), json({ ok: 1 }));
    await fetchFirstSuccess(urls, opts({ hedgeMs: 5 }), { fetch: spy as any, lookup: PUBLIC });
    expect(seen[0]).toBe("gateway.pinata.cloud"); // first attempt goes to the gateway that worked
  });

  it("a 404 does not demote a gateway (the content is missing, not the gateway)", async () => {
    const urls = ["https://ipfs.io/ipfs/x", "https://dweb.link/ipfs/x"];
    const fake = async () => new Response("nope", { status: 404 });
    await expect(fetchFirstSuccess(urls, opts({ hedgeMs: 5 }), { fetch: fake as any, lookup: PUBLIC })).rejects.toThrow();
    expect(orderByHealth(urls)).toEqual(urls);
  });
});

describe("metadata shapes seen in the wild", () => {
  it("tokenURI that is the JSON itself (not a pointer)", async () => {
    const boom = async () => { throw new Error("network used"); };
    const out = await fetchMetadataJson('{"name":"Inline","image":"https://x/i.png"}', opts(), { fetch: boom as any });
    expect(parseMetadata(out).name).toBe("Inline");
  });

  it("relative image paths resolve against where the metadata came from", () => {
    expect(resolveRelative("1.png", `ipfs://${V0}/meta/1.json`)).toBe(`ipfs://${V0}/meta/1.png`);
    expect(resolveRelative("../img/1.png", `ipfs://${V0}/meta/1.json`)).toBe(`ipfs://${V0}/img/1.png`);
    expect(resolveRelative("1.png", `ipfs://${V0}`)).toBe(`ipfs://${V0}/1.png`);
    expect(resolveRelative("/img/1.png", "https://api.example.com/meta/1")).toBe("https://api.example.com/img/1.png");
    expect(resolveRelative("//cdn.example.com/a.png", "https://x")).toBe("https://cdn.example.com/a.png");
    expect(resolveRelative(`ipfs://${V0}`, "https://x")).toBeNull(); // already absolute
    expect(parseMetadata({ image: "7.png" }, `ipfs://${V0}/meta/7`).imageUri).toBe(`ipfs://${V0}/meta/7.png`);
    expect(parseMetadata({ image: "7.png" }).imageUri).toBeNull(); // no base: cannot resolve
  });

  it("image precedence: image, image_url, then a still-image animation_url", () => {
    expect(parseMetadata({ image_url: "https://x/a.png", image: "https://x/b.png" }).imageUri).toBe("https://x/b.png");
    expect(parseMetadata({ image_url: "ipfs://" + V0 }).imageUri).toBe(`ipfs://${V0}`);
    expect(parseMetadata({ animation_url: `ipfs://${V0}/art.gif` }).imageUri).toBe(`ipfs://${V0}/art.gif`);
    // Video / audio / 3D / html animation_url must never be used as the picture.
    for (const ext of ["mp4", "webm", "glb", "mp3", "html"]) {
      expect(parseMetadata({ animation_url: `https://x/a.${ext}` }).imageUri).toBeNull();
    }
    // …but it is still reported separately.
    expect(parseMetadata({ image: "https://x/i.png", animation_url: "ar://" + AR }).animationUri).toBe(`ar://${AR}`);
  });

  it("an ar:// image is kept canonical and expands to Arweave gateways", () => {
    const m = parseMetadata({ image: `ar://${AR}` });
    expect(m.imageUri).toBe(`ar://${AR}`);
    expect(imageCandidates(m.imageUri, opts())[0]).toBe(`https://arweave.net/${AR}`);
  });
});

describe("image streaming (the engine behind /api/nft/image)", () => {
  const imageRes = (bytes: Uint8Array, type: string | null, init: ResponseInit = {}) =>
    new Response(bytes as any, { status: 200, headers: type ? { "content-type": type } : {}, ...init });
  const read = async (s: ReadableStream<Uint8Array>) => { const r = s.getReader(); const out: number[] = []; for (;;) { const { done, value } = await r.read(); if (done) break; out.push(...value); } return Uint8Array.from(out); };

  it("streams a real image and reports its type", async () => {
    const r = await fetchImageStream(["https://ok.example/a.png"], opts(), { fetch: (async () => imageRes(PNG, "image/png")) as any, lookup: PUBLIC });
    expect(r.contentType).toBe("image/png");
    expect(await read(r.body)).toEqual(PNG);
  });

  it("recognises an image served as octet-stream or with no content-type by its bytes", async () => {
    for (const type of ["application/octet-stream", "text/plain", null]) {
      const r = await fetchImageStream(["https://ok.example/a"], opts(), { fetch: (async () => imageRes(JPEG, type)) as any, lookup: PUBLIC });
      expect(r.contentType).toBe("image/jpeg");
    }
  });

  it("recognises SVG, WebP, GIF and AVIF signatures", () => {
    expect(sniffImageMime(new TextEncoder().encode("<?xml version='1.0'?>\n<svg xmlns='x'/>"))).toBe("image/svg+xml");
    expect(sniffImageMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffImageMime(new TextEncoder().encode("GIF89a...."))).toBe("image/gif");
    expect(sniffImageMime(Uint8Array.from([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]))).toBe("image/avif");
    expect(sniffImageMime(new TextEncoder().encode("<html>nope</html>"))).toBeNull();
  });

  it("rejects HTML and JSON posing as an image, then tries the next gateway", async () => {
    const fake = async (u: any) => (String(u).includes("bad") ? imageRes(new TextEncoder().encode("<html>notice</html>"), "text/html") : imageRes(PNG, "image/png"));
    const r = await fetchImageStream(["https://bad.example/a", "https://good.example/a"], opts({ hedgeMs: 5 }), { fetch: fake as any, lookup: PUBLIC });
    expect(r.sourceUrl).toBe("https://good.example/a");
    // …even when the lying server claims an image type:
    const liar = async () => imageRes(new TextEncoder().encode("<html>notice</html>"), "image/png");
    await expect(fetchImageStream(["https://liar.example/a"], opts(), { fetch: liar as any, lookup: PUBLIC })).rejects.toThrow(/not an image/);
  });

  it("falls through gateways that answer 429, like the real ones do today", async () => {
    const fake = async (u: any) => (String(u).includes("ipfs.io") ? new Response(NOTICE, { status: 429 }) : imageRes(PNG, "image/png"));
    const r = await fetchImageStream([`https://ipfs.io/ipfs/${V0}`, `https://gateway.pinata.cloud/ipfs/${V0}`], opts({ hedgeMs: 5 }), { fetch: fake as any, lookup: PUBLIC });
    expect(r.sourceUrl).toContain("pinata");
  });

  it("enforces the size cap on the declared length and while streaming", async () => {
    const declared = async () => imageRes(PNG, "image/png", { headers: { "content-type": "image/png", "content-length": "99999999" } });
    await expect(fetchImageStream(["https://a.example/x"], opts({ maxImageBytes: 1000 }), { fetch: declared as any, lookup: PUBLIC })).rejects.toThrow(/too large/);

    // Everything in one oversized chunk: rejected up front, so the next gateway can be tried.
    const big = new Uint8Array(5000); big.set(PNG);
    await expect(fetchImageStream(["https://a.example/x"], opts({ maxImageBytes: 1000 }), { fetch: (async () => imageRes(big, "image/png")) as any, lookup: PUBLIC })).rejects.toThrow(/too large/);

    // No content-length and a first chunk that fits: the cap is enforced as the rest streams in.
    const chunked = async () => {
      const part = new Uint8Array(600); part.set(PNG);
      let n = 0;
      return new Response(new ReadableStream({ pull(c) { n < 5 ? (c.enqueue(part), n++) : c.close(); } }), { status: 200, headers: { "content-type": "image/png" } });
    };
    const r = await fetchImageStream(["https://a.example/x"], opts({ maxImageBytes: 1000 }), { fetch: chunked as any, lookup: PUBLIC });
    await expect(read(r.body)).rejects.toThrow(/too large/);
  });

  it("re-checks every redirect hop against the SSRF guard", async () => {
    const fake = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
    await expect(fetchImageStream(["https://start.example/a"], opts(), { fetch: fake as any, lookup: PUBLIC })).rejects.toThrow(/private/);
  });

  it("refuses non-image content (JSON metadata) even with a generic type", async () => {
    const fake = async () => imageRes(new TextEncoder().encode('{"name":"x"}'), "application/json");
    await expect(fetchImageStream(["https://a.example/x"], opts(), { fetch: fake as any, lookup: PUBLIC })).rejects.toThrow(/not an image/);
  });
});
