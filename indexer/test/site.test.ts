import { beforeEach, describe, expect, it } from "vitest";
import { applySwapEvents, ZERO, type SwapEventRow } from "../src/swaps.js";
import { listSwaps } from "../../web/lib/server/swaps.js";
import { getSiteStats } from "../../web/lib/server/stats.js";
import { getSiteStatus } from "../../web/lib/server/status.js";
import { A, testDb } from "./helpers.js";

const T0 = new Date("2030-01-01T00:00:00Z");
const FUTURE = Math.floor(new Date("2099-01-01T00:00:00Z").getTime() / 1000);
const PAST = Math.floor(new Date("2000-01-01T00:00:00Z").getTime() / 1000);
let n = 0;
const ev = (kind: SwapEventRow["kind"], id: string, block: number, args: Record<string, any>): SwapEventRow => ({
  kind, swapId: id, blockNumber: BigInt(block), logIndex: n++ % 50, txHash: `0x${(++n).toString(16).padStart(64, "0")}`, blockHash: `0xb${block}`, blockTime: T0, args,
});
const created = (id: string, block: number, o: { maker?: string; taker?: string; expiry?: number; offeredMon?: string; wantedMon?: string } = {}) =>
  ev("created", id, block, {
    tradeId: id, maker: o.maker ?? A.maker, taker: o.taker ?? A.taker, expiry: o.expiry ?? FUTURE,
    offeredMon: o.offeredMon ?? "0", wantedMon: o.wantedMon ?? "0",
    offered: [{ nft: A.chog, tokenId: id }], wanted: [],
  });

beforeEach(() => void (n = 0));

describe("public offers", () => {
  it("lists only open, unexpired offers with no designated taker, newest first, and needs no user", async () => {
    const db = await testDb();
    await applySwapEvents(db, [
      created("1", 10, { taker: ZERO }),                      // public, live
      created("2", 11, { taker: A.taker }),                   // direct: not public
      created("3", 12, { taker: ZERO, expiry: PAST }),        // public but expired
      created("4", 13, { taker: ZERO }),                      // public, live
      created("5", 14, { taker: ZERO }),                      // public, later cancelled
    ]);
    await applySwapEvents(db, [ev("cancelled", "5", 20, { tradeId: "5", maker: A.maker })]);

    const page = await listSwaps(db, { type: "public", limit: 10 });
    expect(page.swaps.map((s) => s.id)).toEqual(["4", "1"]);
    expect(page.swaps.every((s) => s.taker === null && s.status === "pending")).toBe(true);
  });

  it("paginates", async () => {
    const db = await testDb();
    await applySwapEvents(db, ["1", "2", "3"].map((id, i) => created(id, 10 + i, { taker: ZERO })));
    const p1 = await listSwaps(db, { type: "public", limit: 2 });
    expect(p1.swaps.map((s) => s.id)).toEqual(["3", "2"]);
    const p2 = await listSwaps(db, { type: "public", limit: 2, cursor: p1.nextCursor });
    expect(p2.swaps.map((s) => s.id)).toEqual(["1"]);
  });
});

describe("site stats", () => {
  it("is all zeros on an empty database", async () => {
    const s = await getSiteStats(await testDb());
    expect(s.totals).toMatchObject({ trades: 0, completed: 0, open: 0, traders: 0, last24h: 0, volumeWei: "0", verifiedCollections: 0 });
    expect(s.recent).toEqual([]);
  });

  it("counts trades, traders, verified collections and MON that actually changed hands", async () => {
    const db = await testDb();
    await db.query("INSERT INTO nft_collections (address, name, is_chog, verified, ecosystem) VALUES ($1,'Chog',true,true,'chog')", [A.chog]);
    await applySwapEvents(db, [
      created("1", 10, { offeredMon: "1000", wantedMon: "500" }), // will complete: 1500 wei of volume
      created("2", 11, { offeredMon: "9999" }),                   // still open: not volume
      created("3", 12, { maker: A.other, taker: ZERO }),
    ]);
    await applySwapEvents(db, [{ ...ev("accepted", "1", 20, { tradeId: "1", maker: A.maker, taker: A.taker, fee: "0" }), blockTime: new Date(T0.getTime() + 3_600_000) }]);

    const s = await getSiteStats(db);
    expect(s.totals).toMatchObject({ trades: 3, completed: 1, open: 2, traders: 3, volumeWei: "1500", verifiedCollections: 1 });
    expect(s.recent).toHaveLength(3);
    expect(s.recent[0]!.id).toBe("1"); // most recent activity is the settlement
    expect(s.recent[0]!.status).toBe("completed");
    expect(s.recent.find((r) => r.id === "3")!.first).toMatchObject({ verified: true });
  });
});

describe("site status (a measured fact, not a constant)", () => {
  const client = (head: bigint | Error) => ({ getBlockNumber: async () => { if (head instanceof Error) throw head; return head; } });
  const dbWithCursor = async (block: number | null) => {
    const db = await testDb();
    if (block !== null) await db.query("INSERT INTO indexer_cursors (name, block, block_hash) VALUES ('sweeper', $1, '0x1')", [block]);
    return db;
  };

  it("operational when the RPC answers and the indexer is caught up", async () => {
    const s = await getSiteStatus(client(1000n), await dbWithCursor(995));
    expect(s).toMatchObject({ level: "operational", rpc: { ok: true, head: "1000" }, indexer: { ok: true, lagBlocks: 5 } });
    expect(s.message).toMatch(/All systems operational/);
  });

  it("outage when the chain RPC is down", async () => {
    const s = await getSiteStatus(client(new Error("ECONNREFUSED")), await dbWithCursor(1));
    expect(s.level).toBe("outage");
    expect(s.rpc.ok).toBe(false);
  });

  it("degraded when the indexer is far behind, never run, or the database is unreachable", async () => {
    expect((await getSiteStatus(client(10_000n), await dbWithCursor(100))).level).toBe("degraded");
    expect((await getSiteStatus(client(10_000n), await dbWithCursor(null))).level).toBe("degraded");
    const broken = { query: async () => { throw new Error("down"); } };
    expect((await getSiteStatus(client(10_000n), broken as any)).level).toBe("degraded");
  });

  it("operational with no database configured (indexer is optional; the app falls back to the chain)", async () => {
    expect((await getSiteStatus(client(5n), null)).level).toBe("operational");
  });
});
