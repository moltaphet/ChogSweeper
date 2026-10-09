import type { Address, PublicClient } from "viem";
import { safeMulticall } from "./multicall";
import { getRedis } from "./cache";
import { getDbOrNull, markDbFailure } from "./db";
import type { Queryable } from "./queryable";
import { nftReadAbi } from "./abi";
import { INDEXER_CHAIN_ID } from "./chains";
import { expandTokenUriTemplate, fetchMetadataJson, parseMetadata, type Trait } from "./nft-resolver";
import { resolverOptions } from "./nft-types";

export interface TokenMetadata {
  name: string | null;
  description: string | null;
  /** Canonical, gateway-independent image reference. */
  imageUri: string | null;
  traits: Trait[];
  tokenUri: string | null;
  /** `ok` = metadata fetched; `unresolved` = the token exists but tokenURI/gateways failed (retry soon). */
  state: "ok" | "unresolved";
  error?: string;
  source: "memory" | "redis" | "db" | "chain";
}

const OK_TTL_MS = 10 * 60_000;
const UNRESOLVED_TTL_MS = 30_000;
const REDIS_OK_TTL_S = 3600;
const REDIS_UNRESOLVED_TTL_S = 60;
const MEMORY_MAX = 2_000;

const g = globalThis as unknown as {
  __metaMemory?: Map<string, { at: number; value: TokenMetadata }>;
  __metaInflight?: Map<string, Promise<TokenMetadata>>;
};
const memory = (g.__metaMemory ??= new Map());
const inflight = (g.__metaInflight ??= new Map());

const keyOf = (chainId: number, contract: string, tokenId: string) => `${chainId}:${contract.toLowerCase()}:${tokenId}`;

function remember(key: string, value: TokenMetadata) {
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value!); // oldest first (insertion order)
  memory.set(key, { at: Date.now(), value });
}

export const RPC_READ_TIMEOUT_MS = 6_000;
export const RPC_READ_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// "Zero data" = the call succeeded but returned nothing to decode: the address has no code, or it is a contract (a proxy, a
// fallback) that does not implement the function. Either way this is not a token contract answering.
const DEFINITIVE_ERROR_NAMES = new Set(["ContractFunctionRevertedError", "ContractFunctionZeroDataError", "AbiDecodingZeroDataError", "ExecutionRevertedError"]);
const DEFINITIVE_MESSAGE = /execution reverted|returned no data|reverted with|zero data/i;

/**
 * The contract answered "no": it reverted, or has no such function. Asking again will not change that.
 *
 * Matches by error NAME and message while walking the `cause` chain, deliberately not with `instanceof`. In a bundled
 * Next.js server two copies of viem can be loaded (one for the app, one pulled in by a dependency), and an error thrown by
 * one is not `instanceof` the other's classes. That made this check silently report "transient" for real reverts in
 * production while it passed in unit tests.
 */
export function isDeterministicFailure(e: unknown): boolean {
  let cur: any = e;
  for (let depth = 0; cur && typeof cur === "object" && depth < 8; depth++, cur = cur.cause) {
    if (DEFINITIVE_ERROR_NAMES.has(cur.name)) return true;
    if (typeof cur.name === "string" && cur.name.endsWith("Error") && DEFINITIVE_MESSAGE.test(`${cur.shortMessage ?? ""} ${cur.details ?? ""} ${cur.name === "AbiDecodingZeroDataError" ? cur.message : ""}`)) return true;
  }
  return false;
}

/** 6s per attempt, retried with backoff on transient failures (timeouts, dropped connections), never on a contract revert. */
export async function withTimeoutRetry<T>(fn: () => Promise<T>, { timeoutMs = RPC_READ_TIMEOUT_MS, retries = RPC_READ_RETRIES, baseDelayMs = 250 } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`rpc timeout after ${timeoutMs}ms`)), timeoutMs))]);
    } catch (e) {
      if (isDeterministicFailure(e) || attempt >= retries) throw e;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

/**
 * The token's metadata pointer: ERC-721 `tokenURI(id)`, or ERC-1155 `uri(id)` for contracts that only have that.
 * Only a definite "this function does not answer" moves on to the next one; a transient RPC failure is retried first
 * and then surfaced as such, so a flaky node is never mistaken for "no metadata".
 */
export async function readTokenUri(client: Pick<PublicClient, "readContract">, contract: Address, tokenId: bigint): Promise<{ uri: string; via: "tokenURI" | "uri" }> {
  const attempt = (functionName: "tokenURI" | "uri") => withTimeoutRetry(() => client.readContract({ address: contract, abi: nftReadAbi, functionName, args: [tokenId] }));
  try {
    return { uri: await attempt("tokenURI"), via: "tokenURI" };
  } catch (first) {
    if (!isDeterministicFailure(first)) throw first;
    try {
      return { uri: await attempt("uri"), via: "uri" };
    } catch (second) {
      if (!isDeterministicFailure(second)) throw second;
      throw first; // neither function answers: report the ERC-721 failure, it is the more familiar one
    }
  }
}

/** The full resolution pipeline for one token against the chain and external gateways (no caching). */
export async function resolveTokenOnChain(client: PublicClient, contract: Address, tokenId: bigint): Promise<TokenMetadata> {
  let tokenUri: string;
  try {
    tokenUri = (await readTokenUri(client, contract, tokenId)).uri;
  } catch (e) {
    return { name: null, description: null, imageUri: null, traits: [], tokenUri: null, state: "unresolved", error: `tokenURI failed: ${shortError(e)}`, source: "chain" };
  }
  try {
    const expanded = expandTokenUriTemplate(tokenUri.trim(), tokenId);
    // `expanded` doubles as the base for relative image paths ("1.png" next to "1.json").
    const parsed = parseMetadata(await fetchMetadataJson(expanded, resolverOptions()), expanded);
    return { name: parsed.name, description: parsed.description, imageUri: parsed.imageUri, traits: parsed.attributes, tokenUri, state: "ok", source: "chain" };
  } catch (e) {
    return { name: null, description: null, imageUri: null, traits: [], tokenUri, state: "unresolved", error: shortError(e), source: "chain" };
  }
}

const shortError = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200);

async function readDb(db: Queryable | null, contract: string, tokenId: string): Promise<TokenMetadata | null> {
  if (!db) return null;
  try {
    const { rows } = await db.query<any>(
      `SELECT name, description, COALESCE(image_uri, image_url) AS image_uri, attributes, token_uri
         FROM nft_tokens WHERE contract = $1 AND token_id = $2 AND meta_status = 'ok'`,
      [contract, tokenId],
    );
    const r = rows[0];
    if (!r) return null;
    return { name: r.name, description: r.description, imageUri: r.image_uri, traits: Array.isArray(r.attributes) ? r.attributes : [], tokenUri: r.token_uri, state: "ok", source: "db" };
  } catch {
    markDbFailure();
    return null;
  }
}

/** Best-effort write-through so the next request (any instance) is a cache hit and the indexer queue skips it. */
async function writeDb(db: Queryable | null, contract: string, tokenId: string, m: TokenMetadata) {
  if (!db || m.state !== "ok") return;
  try {
    await db.query(
      `INSERT INTO nft_tokens (contract, token_id, token_uri, name, description, image_uri, attributes, meta_status, meta_error, meta_fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ok',NULL,now())
       ON CONFLICT (contract, token_id) DO UPDATE SET token_uri = EXCLUDED.token_uri, name = EXCLUDED.name,
         description = EXCLUDED.description, image_uri = EXCLUDED.image_uri, attributes = EXCLUDED.attributes,
         meta_status = 'ok', meta_error = NULL, meta_fetched_at = now()`,
      [contract, tokenId, m.tokenUri, m.name, m.description, m.imageUri, JSON.stringify(m.traits)],
    );
    await db.query("DELETE FROM nft_traits WHERE contract = $1 AND token_id = $2", [contract, tokenId]);
    if (m.traits.length) {
      await db.query(
        `INSERT INTO nft_traits (contract, token_id, trait_type, value)
         SELECT $1, $2, t, v FROM unnest($3::text[], $4::text[]) AS x(t, v) ON CONFLICT DO NOTHING`,
        [contract, tokenId, m.traits.map((t) => t.trait_type), m.traits.map((t) => t.value)],
      );
    }
  } catch {
    markDbFailure();
  }
}

/**
 * Metadata for one token, cheapest source first: process memory, Redis, the indexer database, then the chain
 * plus external gateways. Concurrent requests for the same token share one resolution. Failures are cached
 * briefly (30-60s) so a dead gateway is not hammered, but never permanently, so tokens heal on their own.
 */
export async function getTokenMetadata(
  client: PublicClient,
  chainId: number,
  contract: string,
  tokenId: string,
  ctx: { db?: Queryable | null } = {},
): Promise<TokenMetadata> {
  const db = ctx.db === undefined ? getDbOrNull() : ctx.db;
  const key = keyOf(chainId, contract, tokenId);

  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < (hit.value.state === "ok" ? OK_TTL_MS : UNRESOLVED_TTL_MS)) return { ...hit.value, source: "memory" };

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<TokenMetadata> => {
    const redis = getRedis();
    if (redis) {
      try {
        const cached = await redis.get<TokenMetadata>(`nft:meta:v1:${key}`);
        if (cached) {
          remember(key, cached);
          return { ...cached, source: "redis" };
        }
      } catch { /* cache outage: keep going */ }
    }

    if (chainId === INDEXER_CHAIN_ID) {
      const fromDb = await readDb(db, contract.toLowerCase(), tokenId);
      if (fromDb) {
        remember(key, fromDb);
        return fromDb;
      }
    }

    const fresh = await resolveTokenOnChain(client, contract as Address, BigInt(tokenId));
    remember(key, fresh);
    if (redis) {
      redis.set(`nft:meta:v1:${key}`, fresh, { ex: fresh.state === "ok" ? REDIS_OK_TTL_S : REDIS_UNRESOLVED_TTL_S }).catch(() => {});
    }
    if (chainId === INDEXER_CHAIN_ID) await writeDb(db, contract.toLowerCase(), tokenId, fresh);
    return fresh;
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

/** Resolves many tokens with bounded parallelism and an overall time budget; tokens that miss it stay `unresolved`. */
export async function getManyTokenMetadata(
  client: PublicClient,
  chainId: number,
  tokens: ReadonlyArray<{ contract: string; tokenId: string }>,
  opts: { concurrency?: number; budgetMs?: number; db?: Queryable | null } = {},
): Promise<Map<string, TokenMetadata>> {
  const { concurrency = 6, budgetMs = 3_000 } = opts;
  const out = new Map<string, TokenMetadata>();
  const deadline = Date.now() + budgetMs;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tokens.length) }, async () => {
      while (next < tokens.length && Date.now() < deadline) {
        const t = tokens[next++]!;
        const remaining = Math.max(50, deadline - Date.now());
        const timeout = new Promise<TokenMetadata>((r) =>
          setTimeout(() => r({ name: null, description: null, imageUri: null, traits: [], tokenUri: null, state: "unresolved", error: "time budget exceeded", source: "chain" }), remaining),
        );
        // The underlying resolution keeps running and warms the cache for the next request even if it loses the race.
        out.set(`${t.contract.toLowerCase()}:${t.tokenId}`, await Promise.race([getTokenMetadata(client, chainId, t.contract, t.tokenId, { db: opts.db }), timeout]));
      }
    }),
  );
  return out;
}

const names = new Map<string, string | null>();

/** Collection names via one batched name() call per cache miss. Failures are remembered as null for the process lifetime. */
export async function getCollectionNames(client: Pick<PublicClient, "multicall" | "readContract">, contracts: readonly string[]): Promise<Map<string, string | null>> {
  const missing = [...new Set(contracts.map((c) => c.toLowerCase()))].filter((c) => !names.has(c));
  if (missing.length) {
    try {
      const res = await safeMulticall(
        client,
        missing.map((c) => ({ address: c as Address, abi: nftReadAbi, functionName: "name" as const })),
      );
      res.forEach((r, i) => names.set(missing[i]!, r.status === "success" ? String(r.result).slice(0, 100) : null));
    } catch {
      /* leave unknown; the caller falls back to a generic label */
    }
  }
  return new Map(contracts.map((c) => [c.toLowerCase(), names.get(c.toLowerCase()) ?? null]));
}

export function clearMetadataMemory() {
  memory.clear();
  inflight.clear();
  names.clear();
}
