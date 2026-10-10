import type { Address, PublicClient } from "viem";
import { erc721ReadAbi } from "./abi.js";
import type { Db, Queryable } from "./db.js";
import { log } from "./log.js";
import { expandTokenUriTemplate, fetchMetadataJson, parseMetadata, type ResolverOptions } from "./nft-resolver.js";
import { sleep } from "./retry.js";

const MAX_ATTEMPTS = 6;
const LEASE_SECONDS = 120;

// ----------------------------------------------------------------- collections

export async function syncCollections(
  db: Queryable,
  client: PublicClient,
  seeds: ReadonlyArray<{ address: Address; startBlock: bigint; ecosystem: "chog" | "monad" | null }>,
  chog: Address | null,
) {
  for (const s of seeds) {
    const existing = await db.query("SELECT 1 FROM nft_collections WHERE address = $1", [s.address]);
    if (existing.rows.length) {
      // Config is the source of truth for verification; re-applied on every boot.
      await db.query(
        "UPDATE nft_collections SET is_chog = $2, verified = $3, ecosystem = $4 WHERE address = $1",
        [s.address, s.address === chog, s.ecosystem !== null, s.ecosystem],
      );
      continue;
    }
    const [name, symbol] = await Promise.all([
      client.readContract({ address: s.address, abi: erc721ReadAbi, functionName: "name" }).catch(() => null),
      client.readContract({ address: s.address, abi: erc721ReadAbi, functionName: "symbol" }).catch(() => null),
    ]);
    await db.query(
      `INSERT INTO nft_collections (address, name, symbol, is_chog, verified, ecosystem, start_block, backfilled_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [s.address, name, symbol, s.address === chog, s.ecosystem !== null, s.ecosystem, s.startBlock.toString(), (s.startBlock - 1n).toString()],
    );
    log.info("collection registered", { address: s.address, name });
  }
}

// ----------------------------------------------------------------- worker

interface Claimed {
  contract: string;
  token_id: string;
  token_uri: string | null;
}

/** Leases a batch so that several workers never fetch the same token (`SKIP LOCKED`). */
async function claim(db: Db, limit: number): Promise<Claimed[]> {
  const { rows } = await db.query<Claimed>(
    `UPDATE nft_tokens t
        SET meta_attempts = t.meta_attempts + 1,
            meta_next_attempt = now() + make_interval(secs => ${LEASE_SECONDS})
       FROM (SELECT contract, token_id FROM nft_tokens
              WHERE meta_status <> 'ok' AND meta_attempts < ${MAX_ATTEMPTS} AND meta_next_attempt <= now()
                AND (owner IS NOT NULL OR EXISTS (SELECT 1 FROM swap_assets a WHERE a.contract = nft_tokens.contract AND a.token_id = nft_tokens.token_id))
                AND contract IN (SELECT address FROM nft_collections)
              ORDER BY meta_next_attempt
              LIMIT $1
              FOR UPDATE SKIP LOCKED) pick
      WHERE t.contract = pick.contract AND t.token_id = pick.token_id
      RETURNING t.contract, t.token_id, t.token_uri`,
    [limit],
  );
  return rows;
}

async function resolveOne(db: Db, client: PublicClient, t: Claimed, resolver: ResolverOptions) {
  try {
    let uri = t.token_uri;
    if (!uri) {
      uri = await client.readContract({ address: t.contract as Address, abi: erc721ReadAbi, functionName: "tokenURI", args: [BigInt(t.token_id)] });
    }
    // Any URI form (ipfs, ar, data, http) with gateway fallback; throws if every source fails.
    const expanded = expandTokenUriTemplate(uri.trim(), BigInt(t.token_id));
    const meta = parseMetadata(await fetchMetadataJson(expanded, resolver), expanded);

    await db.tx(async (q) => {
      await q.query(
        `UPDATE nft_tokens SET token_uri = $3, name = $4, description = $5, image_uri = $6, attributes = $7,
                meta_status = 'ok', meta_error = NULL, meta_fetched_at = now() WHERE contract = $1 AND token_id = $2`,
        [t.contract, t.token_id, uri, meta.name, meta.description, meta.imageUri, JSON.stringify(meta.attributes)],
      );
      await q.query("DELETE FROM nft_traits WHERE contract = $1 AND token_id = $2", [t.contract, t.token_id]);
      for (const a of meta.attributes) {
        await q.query(
          "INSERT INTO nft_traits (contract, token_id, trait_type, value) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [t.contract, t.token_id, a.trait_type, a.value],
        );
      }
    });
    return true;
  } catch (e) {
    // Exponential retry schedule: 1, 2, 4, ... minutes (capped at 1h); gives up after MAX_ATTEMPTS.
    await db.query(
      `UPDATE nft_tokens SET meta_status = 'failed', meta_error = $3,
              meta_next_attempt = now() + make_interval(mins => LEAST(60, power(2, meta_attempts - 1)::int))
        WHERE contract = $1 AND token_id = $2`,
      [t.contract, t.token_id, String(e instanceof Error ? e.message : e).slice(0, 500)],
    );
    log.warn("metadata fetch failed", { contract: t.contract, tokenId: t.token_id, err: String(e) });
    return false;
  }
}

/** Processes one batch and returns how many tokens were claimed. */
export async function resolveBatch(db: Db, client: PublicClient, resolver: ResolverOptions, concurrency: number): Promise<number> {
  const batch = await claim(db, concurrency * 4);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batch.length) }, async () => {
      while (next < batch.length) {
        const t = batch[next++]!;
        await resolveOne(db, client, t, resolver);
      }
    }),
  );
  return batch.length;
}

export async function runMetadataWorker(o: { db: Db; client: PublicClient; resolver: ResolverOptions; concurrency: number; signal: AbortSignal }) {
  while (!o.signal.aborted) {
    const n = await resolveBatch(o.db, o.client, o.resolver, o.concurrency);
    if (n === 0) await sleep(2_000, o.signal);
  }
}
