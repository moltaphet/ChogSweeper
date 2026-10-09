import type { PublicClient } from "viem";
import type { Queryable } from "./queryable";

export type Level = "operational" | "degraded" | "outage";

export interface SiteStatus {
  level: Level;
  /** One short human sentence for the footer. */
  message: string;
  rpc: { ok: boolean; head: string | null; ms: number | null };
  /** null = no database configured / unreachable. */
  indexer: { ok: boolean | null; lagBlocks: number | null };
  checkedAt: string;
}

const LAG_DEGRADED_BLOCKS = 60; // ~30s at 0.5s blocks

/**
 * A measured health summary, never a constant:
 *   outage      the chain RPC does not answer
 *   degraded    the RPC works but the indexer is unreachable or far behind (lists and activity may be stale)
 *   operational both are fine
 */
export async function getSiteStatus(client: Pick<PublicClient, "getBlockNumber">, db: Queryable | null): Promise<SiteStatus> {
  const t0 = Date.now();
  let head: bigint | null = null;
  try {
    head = await Promise.race([client.getBlockNumber(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000))]);
  } catch {
    head = null;
  }
  const rpc = { ok: head !== null, head: head?.toString() ?? null, ms: head !== null ? Date.now() - t0 : null };

  let lagBlocks: number | null = null;
  let indexerOk: boolean | null = null;
  if (db) {
    try {
      const { rows } = await db.query<{ block: string }>("SELECT block FROM indexer_cursors WHERE name = 'sweeper'");
      if (rows[0] && head !== null) {
        lagBlocks = Math.max(0, Number(head - BigInt(rows[0].block)));
        indexerOk = lagBlocks <= LAG_DEGRADED_BLOCKS;
      } else {
        indexerOk = rows[0] ? null : false; // database up but the indexer has never run
      }
    } catch {
      indexerOk = false;
    }
  }

  const level: Level = !rpc.ok ? "outage" : indexerOk === false ? "degraded" : "operational";
  const message =
    level === "operational" ? "All systems operational on Monad Testnet"
    : level === "outage" ? "Cannot reach Monad Testnet right now"
    : lagBlocks === null ? "Indexer unavailable: lists and activity may be out of date"
    : `Indexer is ${lagBlocks} blocks behind: lists may lag`;
  return { level, message, rpc, indexer: { ok: indexerOk, lagBlocks }, checkedAt: new Date().toISOString() };
}
