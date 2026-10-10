import type { Address, PublicClient } from "viem";
import { erc721Events } from "./abi.js";
import type { Queryable } from "./db.js";
import { ZERO } from "./swaps.js";

export interface TransferRow {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  contract: string;
  tokenId: string;
  from: string;
  to: string;
}

/**
 * Stores transfers (idempotently) and derives current ownership from the latest transfer per token.
 * Because ownership is a pure function of the stored transfers, replays and backfills that overlap
 * with the live stream can never regress an owner.
 * Returns the wallets whose inventory changed.
 */
export async function applyTransfers(q: Queryable, rows: readonly TransferRow[]): Promise<string[]> {
  if (rows.length === 0) return [];
  for (const t of rows) {
    await q.query(
      `INSERT INTO nft_transfers (tx_hash, log_index, block_number, block_hash, contract, token_id, from_addr, to_addr)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tx_hash, log_index) DO NOTHING`,
      [t.txHash, t.logIndex, t.blockNumber.toString(), t.blockHash, t.contract, t.tokenId, t.from, t.to],
    );
  }
  await recomputeOwners(q, rows.map((r) => [r.contract, r.tokenId] as const));
  return [...new Set(rows.flatMap((r) => [r.from, r.to]).filter((a) => a !== ZERO))];
}

async function recomputeOwners(q: Queryable, tokens: ReadonlyArray<readonly [string, string]>) {
  const seen = new Set<string>();
  const contracts: string[] = [];
  const ids: string[] = [];
  for (const [c, id] of tokens) {
    if (seen.has(`${c}:${id}`)) continue;
    seen.add(`${c}:${id}`);
    contracts.push(c);
    ids.push(id);
  }
  await q.query(
    `INSERT INTO nft_tokens (contract, token_id, owner)
     SELECT DISTINCT ON (t.contract, t.token_id)
            t.contract, t.token_id, CASE WHEN t.to_addr = $3 THEN NULL ELSE t.to_addr END
       FROM nft_transfers t
      WHERE (t.contract, t.token_id) IN (SELECT * FROM unnest($1::text[], $2::numeric[]))
      ORDER BY t.contract, t.token_id, t.block_number DESC, t.log_index DESC
     ON CONFLICT (contract, token_id) DO UPDATE SET owner = EXCLUDED.owner`,
    [contracts, ids, ZERO],
  );
}

/** Reorg: drop transfers >= fromBlock and re-derive owners. Returns the wallets affected. */
export async function rewindTransfers(q: Queryable, fromBlock: bigint): Promise<string[]> {
  const { rows } = await q.query<{ contract: string; token_id: string; from_addr: string; to_addr: string }>(
    "DELETE FROM nft_transfers WHERE block_number >= $1 RETURNING contract, token_id, from_addr, to_addr",
    [fromBlock.toString()],
  );
  if (rows.length === 0) return [];
  const tokens = rows.map((r) => [r.contract, String(r.token_id)] as const);
  // Tokens whose every transfer was rolled back have no owner source left.
  await q.query(
    `UPDATE nft_tokens SET owner = NULL WHERE (contract, token_id) IN (SELECT * FROM unnest($1::text[], $2::numeric[]))`,
    [tokens.map((t) => t[0]), tokens.map((t) => t[1])],
  );
  await recomputeOwners(q, tokens);
  return [...new Set(rows.flatMap((r) => [r.from_addr, r.to_addr]).filter((a) => a !== ZERO))];
}

export async function fetchTransfers(client: PublicClient, addresses: Address[], from: bigint, to: bigint): Promise<TransferRow[]> {
  if (addresses.length === 0) return [];
  const logs = await client.getLogs({ address: addresses, events: erc721Events, fromBlock: from, toBlock: to, strict: true });
  return logs.map((l) => ({
    txHash: l.transactionHash,
    logIndex: l.logIndex,
    blockNumber: l.blockNumber,
    blockHash: l.blockHash,
    contract: l.address.toLowerCase(),
    tokenId: l.args.tokenId.toString(),
    from: l.args.from.toLowerCase(),
    to: l.args.to.toLowerCase(),
  }));
}
