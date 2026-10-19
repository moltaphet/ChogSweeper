import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";
import { createInventoryCache } from "./cache.js";
import { createRpcClient, createWaker } from "./chain.js";
import { loadConfig } from "./config.js";
import { createPgDb } from "./db.js";
import { log } from "./log.js";
import { workerHealth, type Progress } from "./health.js";
import { resolveBatch, runMetadataWorker, syncCollections } from "./metadata.js";
import { migrate } from "./migrate.js";
import { sleep, supervise } from "./retry.js";
import { runStream } from "./stream.js";
import { applySwapEvents, fetchSwapEvents, rewindSwaps, sweepExpired } from "./swaps.js";
import { advanceTransferCoverage, applyTransfers, fetchTransfers, rewindTransfers } from "./transfers.js";

const once = process.argv.includes("--once");
const migrationsDir = process.env.MIGRATIONS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

async function main() {
  const cfg = loadConfig();
  const client = createRpcClient(cfg);
  if (await client.getChainId() !== cfg.chainId) throw new Error("RPC chain id does not match CHAIN_ID");
  const db = createPgDb(cfg.databaseUrl);
  const cache = createInventoryCache(cfg.redis);
  const waker = createWaker(cfg);
  const ac = new AbortController();
  const { signal } = ac;

  await migrate(db, migrationsDir);
  await syncCollections(db, client, cfg.collections, cfg.chog);

  const progress: Progress = {};
  const track = (name: string) => (cursor: bigint, head: bigint) => {
    progress[name] = { cursor: cursor.toString(), head: head.toString(), at: Date.now() };
  };

  const common = {
    client, db, signal,
    maxRange: cfg.maxRange, confirmations: cfg.confirmations, rewindDepth: cfg.rewindDepth,
    wake: () => waker.wake(), untilCaughtUp: once,
  };

  // --- Stream 1: ChogSweeper swap events ------------------------------------------------------
  const sweeperStream = () =>
    runStream({
      ...common,
      name: "sweeper",
      startBlock: cfg.sweeperDeployBlock,
      onProgress: track("sweeper"),
      process: async (from, to, q) => applySwapEvents(q, await fetchSwapEvents(client, cfg.sweeper, from, to)),
      rewind: (fromBlock, q) => rewindSwaps(q, fromBlock),
    });

  // --- Stream 2: ERC-721 Transfer logs for tracked collections --------------------------------
  const dirty = new Set<string>();
  const trackedCollections = async (q: { query: typeof db.query }) =>
    (await q.query<{ address: Address }>("SELECT address FROM nft_collections")).rows.map((r) => r.address);

  const initialHead = await client.getBlockNumber();
  const transfersStart = initialHead >= cfg.confirmations ? initialHead - cfg.confirmations : 0n;
  const transferStream = () =>
    runStream({
      ...common,
      name: "transfers",
      // First boot only: follow the chain from "now". Older history is the backfill task's job.
      startBlock: transfersStart,
      onProgress: track("transfers"),
      process: async (from, to, q) => {
        const addrs = await trackedCollections(q);
        (await applyTransfers(q, await fetchTransfers(client, addrs, from, to))).forEach((a) => dirty.add(a));
        await advanceTransferCoverage(q, from, to);
      },
      rewind: async (fromBlock, q) => (await rewindTransfers(q, fromBlock)).forEach((a) => dirty.add(a)),
      afterCommit: async () => {
        const wallets = [...dirty];
        dirty.clear();
        await cache.invalidate(wallets);
      },
    });

  // --- Backfill: collections added after the live cursor already passed their start block ------
  const backfill = async () => {
    const cur = await db.query<{ block: string }>("SELECT block FROM indexer_cursors WHERE name = 'transfers'");
    if (!cur.rows[0]) return;
    const upTo = BigInt(cur.rows[0].block);
    const { rows } = await db.query<{ address: Address; backfilled_to: string }>(
      "SELECT address, backfilled_to FROM nft_collections WHERE backfilled_to < $1",
      [upTo.toString()],
    );
    for (const c of rows) {
      let from = BigInt(c.backfilled_to) + 1n;
      while (from <= upTo && !signal.aborted) {
        const to = from + cfg.maxRange - 1n < upTo ? from + cfg.maxRange - 1n : upTo;
        const touched = await db.tx(async (q) => {
          // Serialize with the live stream/reorg handler. Never insert orphaned history after a rewind.
          await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["transfers"]);
          const current = await q.query<{ block: string; backfilled_to: string }>(
            "SELECT i.block, c.backfilled_to FROM indexer_cursors i JOIN nft_collections c ON c.address = $1 WHERE i.name = 'transfers'",
            [c.address],
          );
          if (!current.rows[0] || to > BigInt(current.rows[0].block) || BigInt(current.rows[0].backfilled_to) < from - 1n) return null;
          const w = await applyTransfers(q, await fetchTransfers(client, [c.address], from, to));
          await q.query("UPDATE nft_collections SET backfilled_to = GREATEST(backfilled_to, $2::bigint) WHERE address = $1", [c.address, to.toString()]);
          return w;
        });
        if (touched === null) break; // live cursor rewound; take a fresh snapshot on the next pass
        await cache.invalidate(touched);
        from = to + 1n;
      }
      log.info("collection backfilled", { address: c.address, upTo });
    }
  };

  // --- Health endpoint (Cloud Run / Docker healthcheck) ----------------------------------------
  const server = http.createServer((req, res) => {
    if (req.url !== "/healthz") return void res.writeHead(404).end();
    const health = workerHealth(progress);
    res.writeHead(health.ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(health));
  });

  const shutdown = (sig: string) => {
    log.info("shutting down", { sig });
    ac.abort();
    waker.close();
    server.close();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  if (once) {
    await sweeperStream();
    await transferStream();
    await backfill();
    await sweepExpired(db);
    for (let i = 0; i < 50 && (await resolveBatch(db, client, cfg.resolver, cfg.metadataConcurrency)) > 0; i++);
    await db.end();
    waker.close();
    return;
  }

  server.listen(cfg.healthPort);
  log.info("indexer starting", { sweeper: cfg.sweeper, collections: cfg.collections.length, ws: !!cfg.wsUrl });

  await Promise.all([
    supervise("sweeper-stream", sweeperStream, signal),
    supervise("transfer-stream", transferStream, signal),
    supervise("backfill", async () => {
      while (!signal.aborted) {
        await backfill();
        await sleep(15_000, signal);
      }
    }, signal),
    supervise("expiry-sweep", async () => {
      while (!signal.aborted) {
        const n = await sweepExpired(db);
        if (n > 0) log.info("trades expired", { count: n });
        await sleep(5_000, signal);
      }
    }, signal),
    supervise("metadata", () => runMetadataWorker({ db, client, resolver: cfg.resolver, concurrency: cfg.metadataConcurrency, signal }), signal),
  ]);
  await db.end();
}

main().catch((e) => {
  log.error("fatal", { err: e instanceof Error ? e.stack : String(e) });
  process.exit(1);
});
