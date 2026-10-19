import { beforeEach, describe, expect, it } from "vitest";
import { discoverOwnedTokens, DEFAULT_DISCOVERY } from "../lib/server/discovery";
import { buildApiNft } from "../lib/server/nft-types";
import { getRegistry, registryFromEnv, resetRegistryCache } from "../lib/server/registry";
import { rateLimit } from "../lib/server/ratelimit";
import { clearMetadataMemory, getCollectionNames, getManyTokenMetadata, getTokenMetadata } from "../lib/server/tokens";
import { getWalletNFTs } from "../lib/server/wallet";
import { testDb } from "../../indexer/test/helpers";

const OWNER = "0x00000000000000000000000000000000000000a1";
const OTHER = "0x00000000000000000000000000000000000000b2";
const CHOG = "0x00000000000000000000000000000000000c0c0c";
const MONAD = "0x000000000000000000000000000000000000d0d0";
const PLAIN = "0x000000000000000000000000000000000000e1e1";

const b64 = (s: string) => Buffer.from(s).toString("base64");
const jsonUri = (o: unknown) => `data:application/json;base64,${b64(JSON.stringify(o))}`;
const SVG = `data:image/svg+xml;base64,${b64("<svg xmlns='http://www.w3.org/2000/svg'/>")}`;

/** A fake chain: per-contract state, enough to drive balanceOf / enumeration / ownerOf / tokenURI / getLogs / name. */
function fakeChain(spec: Record<string, {
  name?: string; enumerable?: boolean; owners: Record<string, string>; uris?: Record<string, string | "revert">;
  receivedBy?: Record<string, string[]>; maxRange?: number;
}>) {
  const calls = { getLogs: 0, tokenURI: 0, multicall: 0, ranges: [] as bigint[] };
  const head = 1_000_000n;
  const call = (address: string, fn: string, args: any[]): any => {
    const c = spec[address.toLowerCase()];
    if (!c) throw new Error("no contract");
    switch (fn) {
      case "name": if (!c.name) throw new Error("revert"); return c.name;
      case "balanceOf": return BigInt(Object.values(c.owners).filter((o) => o === args[0].toLowerCase()).length);
      case "ownerOf": { const o = c.owners[String(args[0])]; if (!o) throw new Error("nonexistent"); return o; }
      case "tokenOfOwnerByIndex": {
        if (!c.enumerable) throw new Error("not enumerable");
        const ids = Object.entries(c.owners).filter(([, o]) => o === args[0].toLowerCase()).map(([id]) => id);
        if (Number(args[1]) >= ids.length) throw new Error("index");
        return BigInt(ids[Number(args[1])]!);
      }
      case "tokenURI": { calls.tokenURI++; const u = c.uris?.[String(args[0])]; if (!u || u === "revert") throw new Error("revert"); return u; }
    }
    throw new Error("unknown " + fn);
  };
  const client: any = {
    async getBlockNumber() { return head; },
    async getCode() { return "0x6001"; },
    async readContract({ address, functionName, args }: any) { return call(address, functionName, args ?? []); },
    async multicall({ contracts, allowFailure }: any) {
      calls.multicall++;
      return contracts.map((c: any) => {
        try { return allowFailure ? { status: "success", result: call(c.address, c.functionName, c.args ?? []) } : call(c.address, c.functionName, c.args ?? []); }
        catch (e) { if (!allowFailure) throw e; return { status: "failure", error: e }; }
      });
    },
    async getLogs({ address, args, fromBlock, toBlock }: any) {
      calls.getLogs++;
      const span = (toBlock as bigint) - (fromBlock as bigint) + 1n;
      calls.ranges.push(span);
      const c = spec[address.toLowerCase()]!;
      if (c.maxRange && Number(span) > c.maxRange) throw new Error("block range too large");
      // Every received token is reported in the newest window, which is where scanning starts.
      if (toBlock !== head) return [];
      return (c.receivedBy?.[args.to.toLowerCase()] ?? []).map((id) => ({ args: { tokenId: BigInt(id) } }));
    },
  };
  return { client, calls };
}

describe("discoverOwnedTokens", () => {
  it("skips collections where the wallet holds nothing (no logs, no enumeration)", async () => {
    const { client, calls } = fakeChain({ [CHOG]: { owners: { "1": OTHER } } });
    const r = await discoverOwnedTokens(client, OWNER, [{ address: CHOG, startBlock: 0n }]);
    expect(r).toEqual({ tokens: [], partial: false, warnings: [] });
    expect(calls.getLogs).toBe(0);
  });

  it("lists tokens via enumeration when the collection supports it", async () => {
    const { client, calls } = fakeChain({ [CHOG]: { enumerable: true, owners: { "7": OWNER, "9": OWNER, "3": OTHER } } });
    const r = await discoverOwnedTokens(client, OWNER, [{ address: CHOG, startBlock: 0n }]);
    expect(r.tokens.map((t) => t.tokenId).sort()).toEqual(["7", "9"]);
    expect(calls.getLogs).toBe(0);
  });

  it("falls back to Transfer logs for non-enumerable collections and drops tokens that were since sold", async () => {
    const { client } = fakeChain({
      [MONAD]: { enumerable: false, owners: { "5": OWNER, "6": OTHER /* received then sold */ }, receivedBy: { [OWNER]: ["5", "6"] } },
    });
    const r = await discoverOwnedTokens(client, OWNER, [{ address: MONAD, startBlock: 0n }]);
    expect(r.tokens).toEqual([{ contract: MONAD, tokenId: "5" }]);
    expect(r.partial).toBe(false);
  });

  it("shrinks the log window when the RPC rejects a range, then succeeds", async () => {
    const { client, calls } = fakeChain({ [MONAD]: { owners: { "5": OWNER }, receivedBy: { [OWNER]: ["5"] }, maxRange: 1000 } });
    const r = await discoverOwnedTokens(client, OWNER, [{ address: MONAD, startBlock: 0n }]);
    expect(r.tokens).toHaveLength(1);
    expect(calls.ranges[0]).toBe(DEFAULT_DISCOVERY.maxLogRange); // first attempt: too big
    expect(calls.ranges.some((x) => x <= 1000n)).toBe(true); // then it shrank
  });

  it("reports partial results when the request budget runs out", async () => {
    const { client } = fakeChain({ [MONAD]: { owners: { "1": OWNER }, receivedBy: { [OWNER]: [] } } });
    const r = await discoverOwnedTokens(client, OWNER, [{ address: MONAD, startBlock: 0n }], { maxLogRequests: 2, maxLogRange: 100n, logLookback: 10_000n });
    expect(r.tokens).toHaveLength(0);
    expect(r.partial).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/found 0 of 1/);
  });

  it("one broken collection does not hide the others", async () => {
    const { client } = fakeChain({ [CHOG]: { enumerable: true, owners: { "1": OWNER } } });
    const r = await discoverOwnedTokens(client, OWNER, [{ address: PLAIN, startBlock: 0n }, { address: CHOG, startBlock: 0n }]);
    expect(r.tokens).toEqual([{ contract: CHOG, tokenId: "1" }]);
    expect(r.warnings.some((w) => w.includes(PLAIN))).toBe(true);
    expect(r.partial).toBe(true);
  });

  it("caps enumeration per collection and says so", async () => {
    const owners = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i), OWNER]));
    const { client } = fakeChain({ [CHOG]: { enumerable: true, owners } });
    const r = await discoverOwnedTokens(client, OWNER, [{ address: CHOG, startBlock: 0n }], { maxPerCollection: 10 });
    expect(r.tokens).toHaveLength(10);
    expect(r.partial).toBe(true);
  });

  it("caps the log fallback too, and reports an incomplete balance", async () => {
    const ids = Array.from({ length: 15 }, (_, i) => String(i));
    const { client } = fakeChain({ [CHOG]: { owners: Object.fromEntries(ids.map((id) => [id, OWNER])), receivedBy: { [OWNER]: ids } } });
    const r = await discoverOwnedTokens(client, OWNER, [{ address: CHOG, startBlock: 0n }], { maxPerCollection: 10 });
    expect(r.tokens).toHaveLength(10);
    expect(r.partial).toBe(true);
  });
});

describe("buildApiNft", () => {
  const base = { contract: CHOG, tokenId: "7", name: null, description: null, traits: [], meta: "ok" as const, collectionName: "Chog" };
  const entry = { address: CHOG, name: "Chog", isChog: true, verified: true, ecosystem: "chog" as const, startBlock: 0n };

  it("expands an ipfs image to every gateway and falls back to a generated name", () => {
    const n = buildApiNft({ ...base, imageUri: "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/7.png", collection: entry });
    expect(n.name).toBe("Chog #7");
    expect(n.image).toMatch(/^\/api\/nft\/image\?url=ipfs%3A%2F%2FQm/); // proxy first: it knows which gateways answer today
    expect(n.imageFallbacks.length).toBeGreaterThanOrEqual(2);
    expect(n.imageFallbacks[0]).toMatch(/^https:\/\/.+\/ipfs\/Qm/);
    expect(n.imageGatewayUrl).toMatch(/^https:\/\/.+\/ipfs\/Qm/);
    expect(n).toMatchObject({ isChog: true, verified: true, ecosystem: "chog" });
  });

  it("inlines small data images but serves large ones from /api/nft/image", () => {
    expect(buildApiNft({ ...base, imageUri: SVG, collection: entry }).image).toBe(SVG);
    const big = `data:image/png;base64,${"A".repeat(20_000)}`;
    expect(buildApiNft({ ...base, imageUri: big, collection: entry }).image).toBe(`/api/nft/image?contract=${CHOG}&tokenId=7`);
  });

  it("unknown collections are unverified", () => {
    expect(buildApiNft({ ...base, imageUri: null, collection: undefined, collectionName: null })).toMatchObject({ verified: false, ecosystem: null, collectionName: "Unknown collection", image: null });
  });

  it("keeps the requested chain in large on-chain image links", () => {
    const n = buildApiNft({ ...base, chainId: 143, imageUri: `data:image/png;base64,${"A".repeat(20_000)}`, collection: undefined });
    expect(n.image).toContain("&chainId=143");
  });
});

describe("registry", () => {
  beforeEach(resetRegistryCache);
  it("reads Chog, verified Monad partners and tracked collections from env", () => {
    const r = registryFromEnv({ NEXT_PUBLIC_CHOG_COLLECTION: CHOG, VERIFIED_COLLECTIONS: `${MONAD}:monad:1200`, NEXT_PUBLIC_COLLECTIONS: PLAIN });
    expect(r.get(CHOG)).toMatchObject({ isChog: true, verified: true, ecosystem: "chog" });
    expect(r.get(MONAD)).toMatchObject({ isChog: false, verified: true, ecosystem: "monad", startBlock: 1200n });
    expect(r.get(PLAIN)).toMatchObject({ verified: false, ecosystem: null });
  });
  it("ignores malformed entries", () => {
    expect(registryFromEnv({ VERIFIED_COLLECTIONS: "nope:monad,0x123:chog", NEXT_PUBLIC_COLLECTIONS: "garbage" }).size).toBe(0);
  });
  it("keeps explicit deploy blocks when an address is also tracked or Chog", () => {
    const r = registryFromEnv({ NEXT_PUBLIC_COLLECTIONS: CHOG, NEXT_PUBLIC_CHOG_COLLECTION: CHOG, VERIFIED_COLLECTIONS: `${CHOG}:chog:1200` });
    expect(r.get(CHOG)?.startBlock).toBe(1200n);
    expect(registryFromEnv({ VERIFIED_COLLECTIONS: `${MONAD}:monad:invalid` }).has(MONAD)).toBe(false);
  });
  it("does not reuse an env-only registry for a healthy database, or verification across chains", async () => {
    await getRegistry(null);
    const db = await testDb();
    await db.query("INSERT INTO nft_collections (address, name, verified, ecosystem) VALUES ($1,'DB',true,'monad')", [MONAD]);
    expect((await getRegistry(db)).get(MONAD)?.name).toBe("DB");
    expect((await getRegistry(null, 143)).size).toBe(0);
    await db.end();
  });
  it("database rows override env, and a failing database falls back to env", async () => {
    const db = await testDb();
    await db.query("INSERT INTO nft_collections (address, name, verified, ecosystem) VALUES ($1,'DB Name',true,'monad')", [MONAD]);
    expect((await getRegistry(db)).get(MONAD)).toMatchObject({ name: "DB Name", verified: true });
    resetRegistryCache();
    const broken = { query: async () => { throw new Error("down"); } };
    process.env.VERIFIED_COLLECTIONS = `${MONAD}:monad`;
    expect((await getRegistry(broken as any)).get(MONAD)?.verified).toBe(true);
    delete process.env.VERIFIED_COLLECTIONS;
  });
});

describe("token metadata service", () => {
  beforeEach(clearMetadataMemory);
  const good = jsonUri({ name: "Chog #1", description: "d", image: SVG, attributes: [{ trait_type: "Hat", value: "Red" }] });

  it("resolves an on-chain (data:) tokenURI with no network", async () => {
    const { client } = fakeChain({ [CHOG]: { owners: { "1": OWNER }, uris: { "1": good } } });
    const m = await getTokenMetadata(client, 1, CHOG, "1");
    expect(m).toMatchObject({ state: "ok", name: "Chog #1", imageUri: SVG, traits: [{ trait_type: "Hat", value: "Red" }], source: "chain" });
  });

  it("caches: the second lookup never touches the chain", async () => {
    const { client, calls } = fakeChain({ [CHOG]: { owners: { "1": OWNER }, uris: { "1": good } } });
    await getTokenMetadata(client, 1, CHOG, "1");
    const again = await getTokenMetadata(client, 1, CHOG, "1");
    expect(calls.tokenURI).toBe(1);
    expect(again.source).toBe("memory");
  });

  it("shares one resolution between concurrent callers", async () => {
    const { client, calls } = fakeChain({ [CHOG]: { owners: { "1": OWNER }, uris: { "1": good } } });
    await Promise.all(Array.from({ length: 20 }, () => getTokenMetadata(client, 1, CHOG, "1")));
    expect(calls.tokenURI).toBe(1);
  });

  it("returns `unresolved` (not an exception) when tokenURI reverts or the URI is unusable", async () => {
    const { client } = fakeChain({ [CHOG]: { owners: { "1": OWNER, "2": OWNER, "3": OWNER }, uris: { "1": "revert", "2": "javascript:alert(1)", "3": "data:application/json;base64,bm90IGpzb24=" } } });
    for (const id of ["1", "2", "3"]) {
      const m = await getTokenMetadata(client, 1, CHOG, id);
      expect(m.state).toBe("unresolved");
      expect(m.error).toBeTruthy();
    }
  });

  it("keeps different chains and tokens apart", async () => {
    const { client } = fakeChain({ [CHOG]: { owners: { "1": OWNER, "2": OWNER }, uris: { "1": good, "2": jsonUri({ name: "Two" }) } } });
    expect((await getTokenMetadata(client, 1, CHOG, "1")).name).toBe("Chog #1");
    expect((await getTokenMetadata(client, 1, CHOG, "2")).name).toBe("Two");
    expect((await getTokenMetadata(client, 2, CHOG, "1")).source).toBe("chain"); // other chain: not a cache hit
  });

  it("does not reuse collection names across chains", async () => {
    const a = fakeChain({ [CHOG]: { name: "Testnet Chog", owners: {} } }).client;
    const b = fakeChain({ [CHOG]: { name: "Mainnet Other", owners: {} } }).client;
    a.chain = { id: 10143 }; b.chain = { id: 143 };
    expect((await getCollectionNames(a, [CHOG])).get(CHOG)).toBe("Testnet Chog");
    expect((await getCollectionNames(b, [CHOG])).get(CHOG)).toBe("Mainnet Other");
  });

  it("bulk resolution honours the time budget and still returns an entry per token", async () => {
    const { client } = fakeChain({ [CHOG]: { owners: { "1": OWNER }, uris: { "1": good } } });
    const out = await getManyTokenMetadata(client, 1, [{ contract: CHOG, tokenId: "1" }], { budgetMs: 2000 });
    expect(out.get(`${CHOG}:1`)?.state).toBe("ok");
  });
});

describe("rate limiter", () => {
  it("allows up to the limit then refuses, per key", async () => {
    const key = "t" + Math.random();
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rateLimit(key, 3, 60)).ok);
    expect(results).toEqual([true, true, true, false]);
    expect((await rateLimit(key + "other", 3, 60)).ok).toBe(true);
  });
});

describe("getWalletNFTs (database path and chain path)", () => {
  beforeEach(() => { clearMetadataMemory(); resetRegistryCache(); });
  const meta1 = jsonUri({ name: "Chog #1", image: SVG, attributes: [{ trait_type: "Hat", value: "Red" }] });

  it("chain only: discovers, resolves, flags verified and Chog first, and reports unresolved tokens", async () => {
    process.env.VERIFIED_COLLECTIONS = `${CHOG}:chog,${MONAD}:monad`;
    const { client } = fakeChain({
      [MONAD]: { name: "Molandak", enumerable: true, owners: { "4": OWNER }, uris: { "4": jsonUri({ name: "Molandak #4" }) } },
      [CHOG]: { name: "Chog", enumerable: true, owners: { "1": OWNER, "2": OWNER }, uris: { "1": meta1, "2": "revert" } },
    });
    const r = await getWalletNFTs(OWNER, 10143, { db: null, client });

    expect(r.source).toBe("chain");
    expect(r.items.map((i) => `${i.collectionName}#${i.tokenId}`)).toEqual(["Chog#1", "Chog#2", "Molandak#4"]);
    const [one, two, mon] = r.items;
    expect(one).toMatchObject({ name: "Chog #1", meta: "ok", isChog: true, verified: true, traits: [{ trait_type: "Hat", value: "Red" }] });
    expect(one!.image).toBe(SVG);
    expect(two).toMatchObject({ meta: "unresolved", name: "Chog #2", image: null }); // still listed, with a fallback name
    expect(mon).toMatchObject({ verified: true, ecosystem: "monad" });
    expect(r.partial).toBe(true); // because one token is unresolved
    delete process.env.VERIFIED_COLLECTIONS;
  });

  it("extra collections supplied by the caller are scanned and marked unverified", async () => {
    process.env.VERIFIED_COLLECTIONS = `${CHOG}:chog`;
    const { client } = fakeChain({
      [CHOG]: { name: "Chog", enumerable: true, owners: {}, uris: {} },
      [PLAIN]: { name: "Rando", enumerable: true, owners: { "9": OWNER }, uris: { "9": jsonUri({ name: "Rando 9" }) } },
    });
    const r = await getWalletNFTs(OWNER, 10143, { db: null, client, extraCollections: [PLAIN, "not-an-address"] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ collectionName: "Rando", verified: false });
    delete process.env.VERIFIED_COLLECTIONS;
  });

  it("database path: ownership and metadata come from the indexer, and pending tokens are resolved and written back", async () => {
    const db = await testDb();
    await db.query("INSERT INTO nft_collections (address, name, is_chog, verified, ecosystem) VALUES ($1,'Chog',true,true,'chog')", [CHOG]);
    await db.query("INSERT INTO nft_tokens (contract, token_id, owner, name, image_uri, attributes, meta_status) VALUES ($1,1,$2,'Chog #1',$3,'[]','ok')", [CHOG, OWNER, SVG]);
    await db.query("INSERT INTO nft_tokens (contract, token_id, owner) VALUES ($1,2,$2)", [CHOG, OWNER]); // metadata not fetched yet
    await db.query("INSERT INTO nft_tokens (contract, token_id, owner, meta_status, name) VALUES ($1,3,$2,'ok','Not mine')", [CHOG, OTHER]);
    await db.query("UPDATE nft_collections SET backfilled_to = 1000000");
    await db.query("INSERT INTO indexer_cursors (name, block, block_hash) VALUES ('transfers',1000000,'0x1')");

    const { client, calls } = fakeChain({ [CHOG]: { name: "Chog", owners: { "1": OWNER, "2": OWNER }, uris: { "2": jsonUri({ name: "Chog #2 (resolved)", image: SVG }) } } });
    const r = await getWalletNFTs(OWNER, 10143, { db, client });

    expect(r.source).toBe("indexer");
    expect(r.items.map((i) => [i.tokenId, i.name, i.meta])).toEqual([["1", "Chog #1", "ok"], ["2", "Chog #2 (resolved)", "ok"]]);
    expect(calls.getLogs).toBe(0); // tracked collection: no chain scan needed
    // Written back, so the next call (or another instance) does not re-resolve.
    const stored = (await db.query("SELECT meta_status, name FROM nft_tokens WHERE token_id = 2")).rows[0];
    expect(stored).toMatchObject({ meta_status: "ok", name: "Chog #2 (resolved)" });
  });

  it("scans incomplete indexed collections, removes sold tokens and finds missing ones", async () => {
    const db = await testDb();
    await db.query("INSERT INTO nft_collections (address, name, is_chog, verified, ecosystem) VALUES ($1,'Chog',true,true,'chog')", [CHOG]);
    await db.query("INSERT INTO nft_tokens (contract, token_id, owner, name, meta_status) VALUES ($1,1,$2,'Sold token','ok')", [CHOG, OWNER]);
    const { client } = fakeChain({ [CHOG]: { name: "Chog", enumerable: true, owners: { "1": OTHER, "2": OWNER }, uris: { "2": meta1 } } });
    const r = await getWalletNFTs(OWNER, 10143, { db, client });
    expect(r.items.map((i) => i.tokenId)).toEqual(["2"]);
    expect(r.source).toBe("mixed");
    await db.end();
  });

  it("a failing database degrades to a chain scan instead of failing the request", async () => {
    process.env.VERIFIED_COLLECTIONS = `${CHOG}:chog`;
    const { client } = fakeChain({ [CHOG]: { name: "Chog", enumerable: true, owners: { "1": OWNER }, uris: { "1": meta1 } } });
    const broken = { query: async () => { throw new Error("connection refused"); } };
    const r = await getWalletNFTs(OWNER, 10143, { db: broken as any, client });
    expect(r.items).toHaveLength(1);
    expect(r.source).toBe("chain");
    delete process.env.VERIFIED_COLLECTIONS;
  });

  it("rejects bad input", async () => {
    await expect(getWalletNFTs("nope", 10143, { db: null })).rejects.toThrow("invalid address");
    await expect(getWalletNFTs(OWNER, 1)).rejects.toThrow(/Unsupported chainId/);
  });
});

describe("verifiedCollections (landing page ecosystem list)", () => {
  const e = (address: string, o: Partial<import("../lib/server/registry").RegistryEntry>) => ({ address, name: null, isChog: false, verified: true, ecosystem: null as any, startBlock: 0n, ...o });

  it("lists only verified collections, Chog first, then by name", async () => {
    const { verifiedCollections } = await import("../lib/server/collections");
    const reg = new Map([
      ["0xb", e("0xb", { name: "Zeta", ecosystem: "monad" })],
      ["0xa", e("0xa", { name: "Alpha", ecosystem: "monad" })],
      ["0xc", e("0xc", { name: "Chog", isChog: true, ecosystem: "chog" })],
      ["0xd", e("0xd", { name: "Tracked only", verified: false })],
    ]);
    expect(verifiedCollections(reg).map((c) => c.name)).toEqual(["Chog", "Alpha", "Zeta"]);
  });

  it("fills missing names from the chain and sorts unnamed ones last", async () => {
    const { verifiedCollections } = await import("../lib/server/collections");
    const reg = new Map([["0xa", e("0xa", {})], ["0xb", e("0xb", {})], ["0xc", e("0xc", { name: "Named" })]]);
    const out = verifiedCollections(reg, new Map([["0xa", "From chain"]]));
    expect(out.map((c) => c.name)).toEqual(["From chain", "Named", null]);
  });

  it("is empty for an empty registry", async () => {
    const { verifiedCollections } = await import("../lib/server/collections");
    expect(verifiedCollections(new Map())).toEqual([]);
  });
});
