import { describe, expect, it } from "vitest";
import { getLogsChunked } from "../lib/chainLogs";

const client = (head: bigint) => ({ getBlockNumber: async () => head }) as never;

describe("getLogsChunked", () => {
  it("covers the whole span exactly once, in order, in chunks of the requested size", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const out = await getLogsChunked(client(25n), async (a, b) => (calls.push([a, b]), [`${a}-${b}`]), 0n, { range: 10n, minRange: 1n });
    expect(calls).toEqual([[0n, 9n], [10n, 19n], [20n, 25n]]);
    expect(out).toEqual(["0-9", "10-19", "20-25"]);
  });

  it("halves the chunk when the node rejects a span that is too wide, then carries on", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const ok: Array<[bigint, bigint]> = [];
    await getLogsChunked(
      client(399n),
      async (a, b) => {
        calls.push([a, b]);
        if (b - a + 1n > 100n) throw new Error("block range too large");
        ok.push([a, b]);
        return [];
      },
      0n,
      { range: 1000n, minRange: 50n },
    );
    expect(calls[0]).toEqual([0n, 399n]); // first attempt: the whole span, rejected
    expect(ok[0]![0]).toBe(0n);
    expect(ok.at(-1)![1]).toBe(399n);
    for (let i = 1; i < ok.length; i++) expect(ok[i]![0]).toBe(ok[i - 1]![1] + 1n); // no gaps, no overlaps
    expect(Math.max(...ok.map(([a, b]) => Number(b - a + 1n)))).toBeLessThanOrEqual(100);
  });

  it("gives up with the node's error once even the smallest chunk is refused", async () => {
    await expect(getLogsChunked(client(10n), async () => { throw new Error("nope"); }, 0n, { range: 8n, minRange: 2n })).rejects.toThrow("nope");
  });

  it("only looks back maxBlocks from the head, so an old deployment cannot cost thousands of requests", async () => {
    const calls: Array<[bigint, bigint]> = [];
    await getLogsChunked(client(1_000_000n), async (a, b) => (calls.push([a, b]), []), 0n, { range: 100_000n, maxBlocks: 300_000n });
    expect(calls[0]![0]).toBe(700_000n);
    expect(calls.at(-1)![1]).toBe(1_000_000n);
  });
});
