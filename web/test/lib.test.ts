import { describe, expect, it } from "vitest";
import { fromApiSwap } from "../lib/api";
import { mergePublicTrades } from "../lib/chainTrades";
import { ZERO_ADDRESS } from "../lib/config";
import { formatMon, parseMon } from "../lib/format";
import { expiryLabel, formatDuration } from "../lib/time";
import { partitionTrades } from "../lib/trades";
import type { SwapRecord } from "../lib/types";

const ME = "0x00000000000000000000000000000000000000a1" as const;
const YOU = "0x00000000000000000000000000000000000000b2" as const;
const THIRD = "0x00000000000000000000000000000000000000c3" as const;

const trade = (id: number, o: Partial<SwapRecord>): SwapRecord => ({
  id: BigInt(id), maker: YOU, taker: ME, status: "pending", expiry: 4_000_000_000,
  offered: [], wanted: [], offeredMon: 0n, wantedMon: 0n, ...o,
});

describe("partitionTrades", () => {
  const all = [
    trade(1, {}), // direct offer to me
    trade(2, { status: "expired" }), // expired offer to me: not acceptable, so not incoming
    trade(3, { taker: ZERO_ADDRESS }), // open offer: nobody's "incoming"
    trade(4, { maker: ME, taker: YOU }), // mine, pending
    trade(5, { maker: ME, taker: YOU, status: "expired" }), // mine, expired: must stay visible to cancel
    trade(6, { maker: ME, taker: YOU, status: "completed" }),
    trade(7, { status: "declined" }), // someone's offer to me that I declined
    trade(8, { maker: THIRD, taker: YOU, status: "completed" }), // unrelated
  ];
  const lists = partitionTrades(all, ME);

  it("incoming = pending direct offers to me", () => expect(lists.incoming.map((t) => t.id)).toEqual([1n]));
  it("outgoing = my pending and expired offers", () => expect(lists.outgoing.map((t) => t.id)).toEqual([5n, 4n]));
  it("history = my finished trades, newest first, excluding unrelated ones", () =>
    expect(lists.history.map((t) => t.id)).toEqual([7n, 6n]));
  it("matches addresses case-insensitively", () =>
    expect(partitionTrades([trade(1, { taker: ME.toUpperCase().replace("0X", "0x") as `0x${string}` })], ME).incoming).toHaveLength(1));
});

describe("fromApiSwap", () => {
  it("maps wire strings to bigint and null taker to the zero address", () => {
    const t = fromApiSwap({
      id: "12", maker: ME, taker: null, status: "completed", offeredMon: "1500000000000000000", wantedMon: "0",
      expiry: "2030-01-01T00:00:00.000Z", createdTx: "0xaa", settledTx: "0xbb", feePaid: "250",
      offered: [{ contract: THIRD, tokenId: "7", name: "Chog #7", image: "https://x/7.png", collectionName: "Chog", isChog: true, verified: true, ecosystem: "chog" }],
      wanted: [],
    });
    expect(t.id).toBe(12n);
    expect(t.taker).toBe(ZERO_ADDRESS);
    expect(t.offeredMon).toBe(1_500_000_000_000_000_000n);
    expect(t.expiry).toBe(1_893_456_000);
    expect(t.feePaid).toBe(250n);
    expect(t.offered[0]).toMatchObject({ tokenId: 7n, verified: true, ecosystem: "chog", isChog: true });
  });
});

describe("mergePublicTrades", () => {
  it("adds a new chain offer missing from a stale indexer, keeps indexed metadata, and sorts newest first", () => {
    const indexed = trade(4, { taker: ZERO_ADDRESS, createdTx: "0xold", offered: [{ contract: THIRD, tokenId: 4n, name: "Indexed NFT" }] });
    const stale = trade(4, { taker: ZERO_ADDRESS, createdTx: "0xchain", offered: [{ contract: THIRD, tokenId: 4n }] });
    const fresh = trade(5, { taker: ZERO_ADDRESS, createdTx: "0xnew" });
    const result = mergePublicTrades([indexed], [stale, fresh], 1_000);
    expect(result.map((x) => x.id)).toEqual([5n, 4n]);
    expect(result[1]).toMatchObject({ createdTx: "0xold", offered: [{ name: "Indexed NFT" }] });
  });

  it("uses chain status to hide offers accepted, cancelled, expired or past their deadline", () => {
    const indexedOpen = trade(4, { taker: ZERO_ADDRESS });
    const accepted = trade(4, { status: "completed", taker: THIRD });
    const direct = trade(5, { taker: THIRD });
    const expired = trade(6, { taker: ZERO_ADDRESS, expiry: 999 });
    expect(mergePublicTrades([indexedOpen], [accepted, direct, expired], 1_000)).toEqual([]);
  });
});

describe("MON helpers", () => {
  it("parses decimals exactly and rejects junk", () => {
    expect(parseMon("1.5")).toBe(1_500_000_000_000_000_000n);
    expect(parseMon("")).toBe(0n);
    expect(parseMon("0.000000000000000001")).toBe(1n);
    for (const bad of ["-1", "1e3", "abc", ".", "1.0000000000000000001", "1,5"]) expect(parseMon(bad)).toBeNull();
  });
  it("formats without trailing zeros", () => {
    expect(formatMon(1_500_000_000_000_000_000n)).toBe("1.5");
    expect(formatMon(2_000_000_000_000_000_000n)).toBe("2");
    expect(formatMon(1n, 4)).toBe("0");
  });
});

describe("expiry labels", () => {
  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(5 * 60 + 10)).toBe("5m");
    expect(formatDuration(2 * 3600 + 14 * 60)).toBe("2h 14m");
    expect(formatDuration(3 * 86_400 + 4 * 3600)).toBe("3d 4h");
  });
  it("switches wording at the deadline", () => {
    expect(expiryLabel(1_000, 400)).toBe("Expires in 10m");
    expect(expiryLabel(1_000, 1_000)).toBe("Expires in 0s");
    expect(expiryLabel(1_000, 1_000 + 7200)).toBe("Expired 2h 0m ago");
  });
});
