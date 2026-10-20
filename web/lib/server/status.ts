import type { PublicClient } from "viem";
import type { Queryable } from "./queryable";
import { withTimeout } from "./timeout";

export type Level = "operational" | "degraded" | "outage";

export interface SiteStatus {
  level: Level;
  /** One short human sentence for the footer. */
  message: string;
  rpc: { ok: boolean; head: string | null; ms: number | null };
  /** null = no database configured / unreachable. */
  indexer: { ok: boolean | null; lagBlocks: number | null; streams: { sweeper: boolean | null; transfers: boolean | null } };
  checkedAt: string;
}

const LAG_DEGRADED_BLOCKS = 60; // ~30s at 0.5s blocks
const STREAM_STALE_MS = 60_000;

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
    head = await withTimeout(client.getBlockNumber(), 4000);
  } catch {
    head = null;
  }
  const rpc = { ok: head !== null, head: head?.toString() ?? null, ms: head !== null ? Date.now() - t0 : null };

  let lagBlocks: number | null = null;
  let indexerOk: boolean | null = null;
  const streams = { sweeper: null as boolean | null, transfers: null as boolean | null };
  if (db) {
    try {
      const { rows } = await withTimeout(
        db.query<{ name: "sweeper" | "transfers"; block: string; updated_at: Date | string }>(
          "SELECT name, block, updated_at FROM indexer_cursors WHERE name IN ('sweeper', 'transfers')",
        ),
        4000,
      );
      const byName = new Map(rows.map((row) => [row.name, row]));
      const checkedAt = Date.now();
      const lagFor = (name: "sweeper" | "transfers") => {
        const row = byName.get(name);
        if (!row || head === null) return null;
        return Math.max(0, Number(head - BigInt(row.block)));
      };
      const freshFor = (name: "sweeper" | "transfers") => {
        const row = byName.get(name);
        if (!row) return false;
        const updatedAt = row.updated_at instanceof Date ? row.updated_at.getTime() : new Date(row.updated_at).getTime();
        return Number.isFinite(updatedAt) && checkedAt - updatedAt <= STREAM_STALE_MS;
      };
      const sweeperLag = lagFor("sweeper");
      const transfersLag = lagFor("transfers");
      if (head !== null) {
        streams.sweeper = sweeperLag !== null && sweeperLag <= LAG_DEGRADED_BLOCKS && freshFor("sweeper");
        streams.transfers = transfersLag !== null && transfersLag <= LAG_DEGRADED_BLOCKS && freshFor("transfers");
        const knownLags = [sweeperLag, transfersLag].filter((lag): lag is number => lag !== null);
        lagBlocks = knownLags.length ? Math.max(...knownLags) : null;
        indexerOk = streams.sweeper && streams.transfers;
      } else {
        indexerOk = false;
        streams.sweeper = false;
        streams.transfers = false;
      }
    } catch {
      indexerOk = false;
      streams.sweeper = false;
      streams.transfers = false;
    }
  }

  const level: Level = !rpc.ok ? "outage" : indexerOk !== true ? "degraded" : "operational";
  const unhealthyStreams = (Object.entries(streams) as Array<[keyof typeof streams, boolean | null]>)
    .filter(([, ok]) => ok === false)
    .map(([name]) => name === "sweeper" ? "swap indexing" : "NFT transfer indexing");
  const message =
    level === "operational" ? "All systems operational on Monad Testnet"
    : level === "outage" ? "Cannot reach Monad Testnet right now"
    : lagBlocks === null ? "Indexer unavailable: lists and activity may be out of date"
    : `${unhealthyStreams.join(" and ")} delayed${lagBlocks > 0 ? ` (up to ${lagBlocks} blocks behind)` : ""}: lists and activity may lag`;
  return { level, message, rpc, indexer: { ok: indexerOk, lagBlocks, streams }, checkedAt: new Date().toISOString() };
}
