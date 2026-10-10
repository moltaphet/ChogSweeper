import type { PublicClient } from "viem";
import type { Db, Queryable } from "./db.js";
import { log } from "./log.js";

export interface StreamOptions {
  name: string;
  client: PublicClient;
  db: Db;
  /** First block to index when no cursor exists. */
  startBlock: bigint;
  maxRange: bigint;
  confirmations: bigint;
  rewindDepth: bigint;
  signal: AbortSignal;
  wake: () => Promise<void>;
  /** Apply every log in [from, to] using `q` (the same transaction that advances the cursor). */
  process: (from: bigint, to: bigint, q: Queryable) => Promise<void>;
  /** Remove everything derived from blocks >= `fromBlock` (chain reorg). */
  rewind: (fromBlock: bigint, q: Queryable) => Promise<void>;
  /** Runs after each committed batch (cache invalidation). Failures are logged, never fatal. */
  afterCommit?: () => Promise<void>;
  /** Return instead of waiting once caught up (serverless / cron mode). */
  untilCaughtUp?: boolean;
  /** Reports progress for health checks. */
  onProgress?: (cursor: bigint, head: bigint) => void;
}

interface Cursor {
  block: bigint;
  hash: string;
}

async function getCursor(db: Queryable, name: string): Promise<Cursor | null> {
  const { rows } = await db.query<{ block: string; block_hash: string }>("SELECT block, block_hash FROM indexer_cursors WHERE name = $1", [name]);
  return rows[0] ? { block: BigInt(rows[0].block), hash: rows[0].block_hash } : null;
}

async function setCursor(q: Queryable, name: string, block: bigint, hash: string) {
  await q.query(
    `INSERT INTO indexer_cursors (name, block, block_hash) VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE SET block = EXCLUDED.block, block_hash = EXCLUDED.block_hash, updated_at = now()`,
    [name, block.toString(), hash],
  );
}

/**
 * Generic, resumable, reorg-aware log pump.
 *
 * Each batch commits its derived rows and the cursor in ONE transaction, so a crash at any point
 * re-runs at most one batch, and the inserts are idempotent (primary-key deduplication).
 * Before extending the chain it confirms that the stored cursor hash is still canonical; if not it
 * rewinds `rewindDepth` blocks, deletes the derived data and replays.
 */
export async function runStream(o: StreamOptions): Promise<void> {
  const { client, db, name } = o;

  while (!o.signal.aborted) {
    const cursor = await getCursor(db, name);
    const from = cursor ? cursor.block + 1n : o.startBlock;
    const head = await client.getBlockNumber();
    const safe = head - o.confirmations;
    o.onProgress?.(cursor?.block ?? o.startBlock - 1n, head);

    if (from > safe) {
      if (o.untilCaughtUp) return;
      await o.wake();
      continue;
    }

    // Reorg check: is our last processed block still on the canonical chain?
    if (cursor) {
      const canonical = await client.getBlock({ blockNumber: cursor.block });
      if (canonical.hash !== cursor.hash) {
        const target = cursor.block - o.rewindDepth;
        log.warn("reorg detected, rewinding", { stream: name, cursorBlock: cursor.block, rewindTo: target });
        const targetHash = target >= o.startBlock ? (await client.getBlock({ blockNumber: target })).hash : null;
        await db.tx(async (q) => {
          await o.rewind(target + 1n, q);
          if (targetHash) await setCursor(q, name, target, targetHash);
          else await q.query("DELETE FROM indexer_cursors WHERE name = $1", [name]);
        });
        await safeAfter(o);
        continue;
      }
    }

    const to = from + o.maxRange - 1n < safe ? from + o.maxRange - 1n : safe;
    const toBlock = await client.getBlock({ blockNumber: to });
    await db.tx(async (q) => {
      await o.process(from, to, q);
      await setCursor(q, name, to, toBlock.hash);
    });
    await safeAfter(o);
    o.onProgress?.(to, head);
  }
}

async function safeAfter(o: StreamOptions) {
  try {
    await o.afterCommit?.();
  } catch (e) {
    log.warn("afterCommit failed", { stream: o.name, err: String(e) });
  }
}
