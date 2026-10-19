import type { PublicClient } from "viem";
import { sweeperEvents } from "./abi.js";
import type { Queryable } from "./db.js";

export const ZERO = "0x0000000000000000000000000000000000000000";

export type TradeStatus = "PENDING" | "ACCEPTED" | "CANCELLED" | "DECLINED" | "EXPIRED";

export type SwapEventKind = "created" | "accepted" | "cancelled" | "declined";

export interface SwapEventRow {
  kind: SwapEventKind;
  swapId: string;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  blockTime: Date;
  args: Record<string, any>;
}

export interface SwapProjection {
  id: string;
  maker: string;
  taker: string | null;
  status: TradeStatus;
  acceptedBy: string | null;
  feePaid: string | null;
  offeredMon: string;
  wantedMon: string;
  expiry: Date;
  createdBlock: bigint;
  createdTx: string;
  createdAt: Date;
  settledBlock: bigint | null;
  settledTx: string | null;
  settledAt: Date | null;
  offered: Array<{ contract: string; tokenId: string }>;
  wanted: Array<{ contract: string; tokenId: string }>;
}

/** Pure projection: folds a swap's events (in any order) into its current state. */
export function foldSwap(events: readonly SwapEventRow[], now: Date = new Date()): SwapProjection | null {
  const sorted = [...events].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  );
  const created = sorted.find((e) => e.kind === "created");
  if (!created) return null;

  const a = created.args;
  const taker = String(a.taker).toLowerCase();
  const p: SwapProjection = {
    id: created.swapId,
    maker: String(a.maker).toLowerCase(),
    taker: taker === ZERO ? null : taker,
    status: "PENDING",
    acceptedBy: null,
    feePaid: null,
    offeredMon: String(a.offeredMon),
    wantedMon: String(a.wantedMon),
    expiry: new Date(Number(a.expiry) * 1000),
    createdBlock: created.blockNumber,
    createdTx: created.txHash,
    createdAt: created.blockTime,
    settledBlock: null,
    settledTx: null,
    settledAt: null,
    offered: (a.offered as any[]).map((x) => ({ contract: String(x.nft).toLowerCase(), tokenId: String(x.tokenId) })),
    wanted: (a.wanted as any[]).map((x) => ({ contract: String(x.nft).toLowerCase(), tokenId: String(x.tokenId) })),
  };

  // The contract allows exactly one settlement; the first one on the canonical chain wins.
  const settle = sorted.find((e) => e.kind !== "created");
  if (settle) {
    p.status = settle.kind === "accepted" ? "ACCEPTED" : settle.kind === "declined" ? "DECLINED" : "CANCELLED";
    if (settle.kind === "accepted") {
      p.acceptedBy = String(settle.args.taker).toLowerCase();
      p.feePaid = String(settle.args.fee ?? "0");
    }
    p.settledBlock = settle.blockNumber;
    p.settledTx = settle.txHash;
    p.settledAt = settle.blockTime;
  } else if (p.expiry < now) {
    // The contract still reports Active; acceptance is no longer possible, only cancel/decline.
    p.status = "EXPIRED";
  }
  return p;
}

async function writeProjection(q: Queryable, swapId: string, p: SwapProjection | null) {
  if (!p) {
    await q.query("DELETE FROM swaps WHERE id = $1", [swapId]); // cascades to swap_assets
    return;
  }
  for (const [address, block, at] of [
    [p.maker, p.createdBlock, p.createdAt],
    ...(p.taker ? [[p.taker, p.createdBlock, p.createdAt] as const] : []),
    ...(p.acceptedBy ? [[p.acceptedBy, p.settledBlock ?? p.createdBlock, p.settledAt ?? p.createdAt] as const] : []),
  ] as const) {
    await q.query(
      `INSERT INTO participants (address, first_seen_block, first_seen_at) VALUES ($1,$2,$3)
       ON CONFLICT (address) DO UPDATE SET
         first_seen_block = LEAST(participants.first_seen_block, EXCLUDED.first_seen_block),
         first_seen_at = LEAST(participants.first_seen_at, EXCLUDED.first_seen_at)`,
      [address, block.toString(), at],
    );
  }
  await q.query(
    `INSERT INTO swaps (id, maker, taker, status, accepted_by, offered_mon, wanted_mon, expiry,
                        created_block, created_tx, created_at, settled_block, settled_tx, settled_at, fee_paid)
     VALUES ($1,$2,$3,$4::"TradeStatus",$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, accepted_by = EXCLUDED.accepted_by,
       settled_block = EXCLUDED.settled_block, settled_tx = EXCLUDED.settled_tx, settled_at = EXCLUDED.settled_at,
       fee_paid = EXCLUDED.fee_paid,
       created_block = EXCLUDED.created_block, created_tx = EXCLUDED.created_tx, created_at = EXCLUDED.created_at`,
    [
      p.id, p.maker, p.taker, p.status, p.acceptedBy, p.offeredMon, p.wantedMon, p.expiry,
      p.createdBlock.toString(), p.createdTx, p.createdAt,
      p.settledBlock?.toString() ?? null, p.settledTx, p.settledAt, p.feePaid,
    ],
  );
  await q.query("DELETE FROM swap_assets WHERE swap_id = $1", [swapId]);
  const rows = [
    ...p.offered.map((x, i) => ["offered", i, x] as const),
    ...p.wanted.map((x, i) => ["wanted", i, x] as const),
  ];
  for (const [side, position, x] of rows) {
    // The asset row references nft_tokens, so make sure the token exists first. This also queues
    // the metadata worker to resolve it even when its owner is unknown.
    await q.query(
      "INSERT INTO nft_tokens (contract, token_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [x.contract, x.tokenId],
    );
    await q.query(
      "INSERT INTO swap_assets (swap_id, side, position, contract, token_id) VALUES ($1,$2,$3,$4,$5)",
      [swapId, side, position, x.contract, x.tokenId],
    );
  }
}

async function loadEvents(q: Queryable, swapId: string): Promise<SwapEventRow[]> {
  const { rows } = await q.query(
    "SELECT kind, swap_id, tx_hash, log_index, block_number, block_hash, block_time, args FROM swap_events WHERE swap_id = $1",
    [swapId],
  );
  return rows.map((r: any) => ({
    kind: r.kind, swapId: String(r.swap_id), txHash: r.tx_hash, logIndex: r.log_index,
    blockNumber: BigInt(r.block_number), blockHash: r.block_hash, blockTime: new Date(r.block_time), args: r.args,
  }));
}

export async function recomputeSwaps(q: Queryable, swapIds: Iterable<string>) {
  for (const id of new Set(swapIds)) {
    await writeProjection(q, id, foldSwap(await loadEvents(q, id)));
  }
}

/** Stores events (idempotently) and recomputes every affected swap. */
export async function applySwapEvents(q: Queryable, events: readonly SwapEventRow[]): Promise<void> {
  for (const e of events) {
    await q.query(
      `INSERT INTO swap_events (tx_hash, log_index, block_number, block_hash, block_time, kind, swap_id, args)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tx_hash, log_index) DO NOTHING`,
      [e.txHash, e.logIndex, e.blockNumber.toString(), e.blockHash, e.blockTime, e.kind, e.swapId, JSON.stringify(e.args)],
    );
  }
  await recomputeSwaps(q, events.map((e) => e.swapId));
}

export async function rewindSwaps(q: Queryable, fromBlock: bigint) {
  const { rows } = await q.query<{ swap_id: string }>("DELETE FROM swap_events WHERE block_number >= $1 RETURNING swap_id", [fromBlock.toString()]);
  await recomputeSwaps(q, rows.map((r) => String(r.swap_id)));
  await recomputeParticipants(q);
}

/** Rebuild participant counts and first-seen data from the canonical swap projection after a reorg. */
async function recomputeParticipants(q: Queryable) {
  await q.query(
    `WITH sightings AS (
       SELECT maker AS address, created_block AS block, created_at AS at FROM swaps
       UNION ALL SELECT taker, created_block, created_at FROM swaps WHERE taker IS NOT NULL
       UNION ALL SELECT accepted_by, settled_block, settled_at FROM swaps WHERE accepted_by IS NOT NULL
     ), canonical AS (
       SELECT address, MIN(block) AS first_seen_block, MIN(at) AS first_seen_at
         FROM sightings GROUP BY address
     )
     INSERT INTO participants (address, first_seen_block, first_seen_at)
     SELECT address, first_seen_block, first_seen_at FROM canonical
     ON CONFLICT (address) DO UPDATE SET
       first_seen_block = EXCLUDED.first_seen_block,
       first_seen_at = EXCLUDED.first_seen_at`,
  );
  await q.query(
    `DELETE FROM participants p
      WHERE NOT EXISTS (SELECT 1 FROM swaps s WHERE s.maker = p.address OR s.taker = p.address OR s.accepted_by = p.address)`,
  );
}

/** Fetches and decodes ChogSweeper logs for a block range. */
export async function fetchSwapEvents(client: PublicClient, address: `0x${string}`, from: bigint, to: bigint): Promise<SwapEventRow[]> {
  const logs = await client.getLogs({ address, events: sweeperEvents, fromBlock: from, toBlock: to, strict: true });
  if (logs.length === 0) return [];

  const times = new Map<bigint, Date>();
  await Promise.all(
    [...new Set(logs.map((l) => l.blockNumber))].map(async (n) => {
      const b = await client.getBlock({ blockNumber: n });
      times.set(n, new Date(Number(b.timestamp) * 1000));
    }),
  );

  const kindOf = { TradeCreated: "created", TradeAccepted: "accepted", TradeCancelled: "cancelled", TradeDeclined: "declined" } as const;
  return logs.map((l) => {
    const args = l.args as Record<string, any>;
    return {
      kind: kindOf[l.eventName],
      swapId: String(args.tradeId),
      txHash: l.transactionHash,
      logIndex: l.logIndex,
      blockNumber: l.blockNumber,
      blockHash: l.blockHash,
      blockTime: times.get(l.blockNumber)!,
      args: JSON.parse(JSON.stringify(args, (_, v) => (typeof v === "bigint" ? v.toString() : v))),
    };
  });
}

/** Marks pending trades whose expiry has passed. Returns how many changed. Cheap: uses swaps_expiry_sweep_idx. */
export async function sweepExpired(q: Queryable): Promise<number> {
  const res = await q.query<{ id: string }>(
    `UPDATE swaps SET status = 'EXPIRED' WHERE status = 'PENDING' AND expiry < now() RETURNING id`,
  );
  return res.rows.length;
}
