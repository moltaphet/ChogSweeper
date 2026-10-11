import type { PublicClient } from "viem";

/**
 * `eth_getLogs` over a long block span, split into chunks. Public RPC nodes cap the span of one request (often to a few
 * hundred or thousand blocks) and answer with an error beyond it, so asking for "deploy block to latest" in one call works on a
 * young chain and silently breaks later. On an error the chunk is halved and retried, down to `minRange`.
 *
 * `maxBlocks` bounds the total look-back so a very old deployment cannot turn one page load into thousands of requests;
 * trades older than that are the indexer's job.
 */
export async function getLogsChunked<T>(
  client: Pick<PublicClient, "getBlockNumber">,
  fetchRange: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  opts: { range?: bigint; minRange?: bigint; maxBlocks?: bigint } = {},
): Promise<T[]> {
  const { range = 10_000n, minRange = 100n, maxBlocks = 2_000_000n } = opts;
  const head = await client.getBlockNumber();
  const start = head - fromBlock > maxBlocks ? head - maxBlocks : fromBlock;
  const out: T[] = [];
  let cursor = start;
  let size = range;
  while (cursor <= head) {
    const to = cursor + size - 1n > head ? head : cursor + size - 1n;
    try {
      out.push(...(await fetchRange(cursor, to)));
      cursor = to + 1n;
    } catch (e) {
      if (size <= minRange) throw e;
      size = size / 2n < minRange ? minRange : size / 2n;
    }
  }
  return out;
}
