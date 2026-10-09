import { describe, expect, it } from "vitest";
import { countUnread, loadSeen, mergeSeen, saveSeen, seenKey } from "../lib/unread";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const ME = "0x00000000000000000000000000000000000000A1";

describe("unread incoming requests", () => {
  it("everything is unread on first visit; opening the list marks exactly what was listed", () => {
    const store = memory();
    const seen = loadSeen(ME, store);
    expect(countUnread(["3", "2", "1"], seen)).toBe(3);

    saveSeen(ME, mergeSeen(seen, ["3", "2", "1"]), store);
    expect(countUnread(["3", "2", "1"], loadSeen(ME, store))).toBe(0);
  });

  it("an offer that arrives later is unread again, older ones stay read", () => {
    const seen = mergeSeen(new Set(), ["1", "2"]);
    expect(countUnread(["4", "2", "1"], seen)).toBe(1);
  });

  it("is per wallet and case-insensitive on the address", () => {
    const store = memory();
    saveSeen(ME, new Set(["7"]), store);
    expect(loadSeen(ME.toLowerCase(), store).has("7")).toBe(true);
    expect(loadSeen("0x00000000000000000000000000000000000000B2", store).size).toBe(0);
    expect(seenKey(ME)).toBe(seenKey(ME.toLowerCase()));
  });

  it("survives unavailable or corrupted storage by showing everything as unread", () => {
    expect(loadSeen(ME, { getItem: () => { throw new Error("blocked"); } }).size).toBe(0);
    expect(loadSeen(ME, { getItem: () => "not json" }).size).toBe(0);
    expect(loadSeen(ME, { getItem: () => '{"a":1}' }).size).toBe(0);
    expect(() => saveSeen(ME, new Set(["1"]), { setItem: () => { throw new Error("quota"); } })).not.toThrow();
  });

  it("keeps the record bounded, dropping the oldest ids", () => {
    const ids = Array.from({ length: 700 }, (_, i) => String(i + 1));
    const seen = mergeSeen(new Set(), ids);
    expect(seen.size).toBe(500);
    expect(seen.has("700")).toBe(true);
    expect(seen.has("1")).toBe(false);
  });
});
