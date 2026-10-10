import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toEventSelector } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import { sweeperEvents } from "../src/abi.js";
import { applySwapEvents, foldSwap, rewindSwaps, sweepExpired, ZERO, type SwapEventRow } from "../src/swaps.js";
import { applyTransfers, rewindTransfers, type TransferRow } from "../src/transfers.js";
import { backoffMs } from "../src/retry.js";
import { listSwaps } from "../../web/lib/server/swaps.js";
import { queryInventory } from "../../web/lib/server/inventory.js";
import { A, testDb } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = new Date("2030-01-01T00:00:00Z");
const FUTURE = Math.floor(new Date("2099-01-01T00:00:00Z").getTime() / 1000);
const PAST = Math.floor(new Date("2000-01-01T00:00:00Z").getTime() / 1000);

let n = 0;
const ev = (kind: SwapEventRow["kind"], swapId: string, block: number, args: Record<string, any>): SwapEventRow => ({
  kind, swapId, blockNumber: BigInt(block), logIndex: n++ % 50, txHash: `0x${(++n).toString(16).padStart(64, "0")}`,
  blockHash: `0xb${block}`, blockTime: T0, args,
});
const created = (id: string, block: number, o: Partial<{ maker: string; taker: string; expiry: number; offeredMon: string; wantedMon: string }> = {}) =>
  ev("created", id, block, {
    tradeId: id, maker: o.maker ?? A.maker, taker: o.taker ?? A.taker, expiry: o.expiry ?? FUTURE,
    offeredMon: o.offeredMon ?? "5000000000000000000", wantedMon: o.wantedMon ?? "0",
    offered: [{ nft: A.chog, tokenId: "1" }], wanted: [{ nft: A.nft2, tokenId: "77" }],
  });

describe("event signatures", () => {
  const abiPath = path.resolve(here, "../../out/ChogSweeper.sol/ChogSweeper.json");
  it.skipIf(!existsSync(abiPath))("match the compiled Solidity contract", () => {
    const abi = JSON.parse(readFileSync(abiPath, "utf8")).abi as any[];
    for (const name of ["TradeCreated", "TradeAccepted", "TradeCancelled", "TradeDeclined"]) {
      const solidity = abi.find((x) => x.type === "event" && x.name === name);
      const mine = sweeperEvents.find((x) => x.type === "event" && x.name === name)!;
      expect(toEventSelector(mine as any)).toBe(toEventSelector(solidity));
    }
  });
});

describe("foldSwap", () => {
  it("is order independent and treats zero taker as open", () => {
    const c = created("1", 10, { taker: ZERO });
    const a = ev("accepted", "1", 12, { tradeId: "1", maker: A.maker, taker: A.other, fee: "250" });
    const p = foldSwap([a, c])!;
    expect(p.taker).toBeNull();
    expect(p.status).toBe("ACCEPTED");
    expect(p.acceptedBy).toBe(A.other);
    expect(p.feePaid).toBe("250");
  });
  it("projects a decline as terminal, with no acceptor or fee", () => {
    const p = foldSwap([created("1", 10), ev("declined", "1", 11, { tradeId: "1", maker: A.maker, taker: A.taker })])!;
    expect(p.status).toBe("DECLINED");
    expect(p.acceptedBy).toBeNull();
    expect(p.feePaid).toBeNull();
  });
  it("returns null without a creation event", () => {
    expect(foldSwap([ev("cancelled", "9", 3, {})])).toBeNull();
  });
});

describe("swap pipeline", () => {
  beforeEach(() => void (n = 0));

  it("projects lifecycle and serves the three list types", async () => {
    const db = await testDb();
    await applySwapEvents(db, [created("1", 10), created("2", 11, { maker: A.other, taker: A.maker }), created("3", 12, { expiry: PAST })]);

    expect((await listSwaps(db, { user: A.taker, type: "incoming", limit: 10 })).swaps.map((s) => s.id)).toEqual(["1"]);
    // Expired swaps are not acceptable, but the maker still sees them to cancel.
    const out = await listSwaps(db, { user: A.maker, type: "outgoing", limit: 10 });
    expect(out.swaps.map((s) => [s.id, s.status])).toEqual([["3", "expired"], ["1", "pending"]]);
    expect((await listSwaps(db, { user: A.maker, type: "history", limit: 10 })).swaps).toHaveLength(0);

    await applySwapEvents(db, [ev("accepted", "1", 20, { tradeId: "1", maker: A.maker, taker: A.taker, fee: "0" })]);
    await applySwapEvents(db, [ev("declined", "2", 21, { tradeId: "2", maker: A.other, taker: A.maker })]);

    const hist = await listSwaps(db, { user: A.maker, type: "history", limit: 10 });
    expect(hist.swaps.map((s) => [s.id, s.status])).toEqual([["2", "declined"], ["1", "completed"]]);
    expect(hist.swaps[1]!.feePaid).toBe("0");
    expect(hist.swaps[1]!.offeredMon).toBe("5000000000000000000");
    expect(hist.swaps[1]!.wanted[0]).toMatchObject({ contract: A.nft2, tokenId: "77" });
  });

  it("is idempotent when the same logs are replayed", async () => {
    const db = await testDb();
    const batch = [created("1", 10), ev("accepted", "1", 11, { tradeId: "1", maker: A.maker, taker: A.taker, fee: "0" })];
    await applySwapEvents(db, batch);
    await applySwapEvents(db, batch);
    expect((await db.query("SELECT count(*)::int AS c FROM swap_events")).rows[0].c).toBe(2);
    expect((await db.query("SELECT count(*)::int AS c FROM swap_assets")).rows[0].c).toBe(2);
  });

  it("rolls back on reorg: settlement undone, creation undone", async () => {
    const db = await testDb();
    await applySwapEvents(db, [created("1", 10), ev("accepted", "1", 15, { tradeId: "1", maker: A.maker, taker: A.taker, fee: "0" }), created("2", 16)]);

    await rewindSwaps(db, 15n);
    expect((await db.query("SELECT status FROM swaps WHERE id = 1")).rows[0].status).toBe("PENDING");
    expect((await db.query("SELECT count(*)::int AS c FROM swaps WHERE id = 2")).rows[0].c).toBe(0);
    expect((await db.query("SELECT count(*)::int AS c FROM swap_assets WHERE swap_id = 2")).rows[0].c).toBe(0);
  });

  it("paginates with a cursor", async () => {
    const db = await testDb();
    await applySwapEvents(db, [1, 2, 3].map((i) => created(String(i), 10 + i)));
    const p1 = await listSwaps(db, { user: A.maker, type: "outgoing", limit: 2 });
    expect(p1.swaps.map((s) => s.id)).toEqual(["3", "2"]);
    const p2 = await listSwaps(db, { user: A.maker, type: "outgoing", limit: 2, cursor: p1.nextCursor });
    expect(p2.swaps.map((s) => s.id)).toEqual(["1"]);
    expect(p2.nextCursor).toBeNull();
  });
});

describe("ownership and inventory", () => {
  const tr = (block: number, logIndex: number, contract: string, tokenId: string, from: string, to: string): TransferRow => ({
    txHash: `0x${block}${logIndex}`.padEnd(66, "0"), logIndex, blockNumber: BigInt(block), blockHash: `0xb${block}`, contract, tokenId, from, to,
  });

  async function seeded() {
    const db = await testDb();
    await db.query("INSERT INTO nft_collections (address, name, is_chog) VALUES ($1,'Chog',true), ($2,'Other',false)", [A.chog, A.nft2]);
    return db;
  }

  it("derives the current owner from the latest transfer, regardless of arrival order", async () => {
    const db = await seeded();
    await applyTransfers(db, [tr(5, 0, A.chog, "1", ZERO, A.maker)]);
    await applyTransfers(db, [tr(9, 2, A.chog, "1", A.maker, A.taker)]);
    // An older log arriving late (backfill overlapping the live stream) must not regress the owner.
    const touched = await applyTransfers(db, [tr(5, 0, A.chog, "1", ZERO, A.maker)]);
    expect(touched).toEqual([A.maker]);
    expect((await db.query("SELECT owner FROM nft_tokens WHERE token_id = 1")).rows[0].owner).toBe(A.taker);
  });

  it("serves a wallet inventory with Chog first and supports filters", async () => {
    const db = await seeded();
    await applyTransfers(db, [tr(1, 0, A.nft2, "5", ZERO, A.maker), tr(1, 1, A.chog, "9", ZERO, A.maker), tr(1, 2, A.chog, "2", ZERO, A.other)]);
    await db.query("UPDATE nft_tokens SET name='Chog #9', image_url='https://x/9.png', attributes='[{\"trait_type\":\"Hat\",\"value\":\"Red\"}]' WHERE token_id=9");

    const all = await queryInventory(db, A.maker.toUpperCase().replace("0X", "0x"), undefined);
    expect(all.map((i) => [i.collectionName, i.tokenId, i.isChog])).toEqual([["Chog", "9", true], ["Other", "5", false]]);
    expect(all[0]).toMatchObject({ name: "Chog #9", image: "https://x/9.png", traits: [{ trait_type: "Hat", value: "Red" }] });
    expect(all[1]!.name).toBe("Other #5"); // fallback before metadata resolves

    expect(await queryInventory(db, A.maker, "chog")).toHaveLength(1);
    expect(await queryInventory(db, A.maker, A.nft2)).toHaveLength(1);
  });

  it("burn removes the token from inventory; reorg restores the previous owner", async () => {
    const db = await seeded();
    await applyTransfers(db, [tr(1, 0, A.chog, "1", ZERO, A.maker), tr(7, 0, A.chog, "1", A.maker, ZERO)]);
    expect(await queryInventory(db, A.maker, undefined)).toHaveLength(0);

    const touched = await rewindTransfers(db, 7n);
    expect(touched).toContain(A.maker);
    expect(await queryInventory(db, A.maker, undefined)).toHaveLength(1);

    await rewindTransfers(db, 1n); // mint itself reorged away
    expect(await queryInventory(db, A.maker, undefined)).toHaveLength(0);
  });
});

describe("expiry, participants and the verified registry", () => {
  beforeEach(() => void (n = 0));

  it("stores EXPIRED for lapsed pending trades, and cancel after expiry wins", () => {
    const lapsed = created("1", 10, { expiry: PAST });
    expect(foldSwap([lapsed])!.status).toBe("EXPIRED");
    expect(foldSwap([lapsed], new Date("1999-01-01"))!.status).toBe("PENDING");
    // The maker can still cancel an expired trade; that settlement is the final state.
    expect(foldSwap([lapsed, ev("cancelled", "1", 11, { tradeId: "1", maker: A.maker })])!.status).toBe("CANCELLED");
  });

  it("sweepExpired flips only lapsed PENDING trades", async () => {
    const db = await testDb();
    // Insert with a future expiry first (so projection says PENDING), then let time pass.
    await applySwapEvents(db, [created("1", 10), created("2", 11)]);
    await db.query("UPDATE swaps SET expiry = now() - interval '1 minute' WHERE id = 1");
    expect(await sweepExpired(db)).toBe(1);
    expect(await sweepExpired(db)).toBe(0); // idempotent
    const rows = (await db.query("SELECT id::text, status FROM swaps ORDER BY id")).rows;
    expect(rows.map((r: any) => [r.id, r.status])).toEqual([["1", "EXPIRED"], ["2", "PENDING"]]);
    // Expired trades are still listed for the maker (so they can cancel) but never as incoming.
    expect((await listSwaps(db, { user: A.maker, type: "outgoing", limit: 10 })).swaps.map((s) => [s.id, s.status])).toEqual([["2", "pending"], ["1", "expired"]]);
    expect((await listSwaps(db, { user: A.taker, type: "incoming", limit: 10 })).swaps.map((s) => s.id)).toEqual(["2"]);
  });

  it("records each wallet once as a participant, with its first sighting", async () => {
    const db = await testDb();
    await applySwapEvents(db, [created("1", 10), created("2", 20, { maker: A.taker, taker: A.maker })]);
    await applySwapEvents(db, [ev("accepted", "1", 30, { tradeId: "1", maker: A.maker, taker: A.taker, fee: "0" })]);
    const rows = (await db.query("SELECT address, first_seen_block::text AS b FROM participants ORDER BY address")).rows;
    expect(rows.map((r: any) => [r.address, r.b])).toEqual([[A.maker, "10"], [A.taker, "10"]]);
  });

  it("exposes verified / ecosystem on swap assets and inventory", async () => {
    const db = await testDb();
    await db.query("INSERT INTO nft_collections (address, name, is_chog, verified, ecosystem) VALUES ($1,'Chog',true,true,'chog'), ($2,'Rando',false,false,NULL)", [A.chog, A.nft2]);
    await applySwapEvents(db, [created("1", 10)]);
    const [swap] = (await listSwaps(db, { user: A.maker, type: "outgoing", limit: 5 })).swaps;
    expect(swap!.offered[0]).toMatchObject({ verified: true, ecosystem: "chog", isChog: true });
    expect(swap!.wanted[0]).toMatchObject({ verified: false, ecosystem: null });

    await applyTransfers(db, [
      { txHash: "0x01", logIndex: 0, blockNumber: 1n, blockHash: "0xb1", contract: A.nft2, tokenId: "5", from: ZERO, to: A.maker },
      { txHash: "0x02", logIndex: 0, blockNumber: 1n, blockHash: "0xb1", contract: A.chog, tokenId: "9", from: ZERO, to: A.maker },
    ]);
    const inv = await queryInventory(db, A.maker, undefined);
    expect(inv.map((i) => [i.collectionName, i.verified, i.ecosystem])).toEqual([["Chog", true, "chog"], ["Rando", false, null]]);
  });

  it("refuses an ecosystem on an unverified collection (registry constraint)", async () => {
    const db = await testDb();
    await expect(db.query("INSERT INTO nft_collections (address, verified, ecosystem) VALUES ($1,false,'monad')", [A.nft2])).rejects.toThrow();
  });
});

describe("retry", () => {
  it("backoff is bounded by the cap", () => {
    for (let i = 0; i < 50; i++) expect(backoffMs(20, 500, 30_000)).toBeLessThanOrEqual(30_000);
  });
});
