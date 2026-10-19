import { isAddress, type PublicClient } from "viem";
import { INDEXER_CHAIN_ID, getClient } from "./chains";
import { getDbOrNull, markDbFailure } from "./db";
import { discoverOwnedTokens, type DiscoveryTarget } from "./discovery";
import { buildApiNft, type ApiNft, type MetaState } from "./nft-types";
import { getRegistry, type RegistryEntry } from "./registry";
import { getCollectionNames, getManyTokenMetadata } from "./tokens";
import type { Queryable } from "./queryable";

export interface WalletNFTs {
  address: string;
  chainId: number;
  count: number;
  items: ApiNft[];
  /** Where ownership came from: the indexer database, a direct chain scan, or both. */
  source: "indexer" | "chain" | "mixed";
  /** True when some tokens may be missing or unresolved; the UI offers manual add / retry. */
  partial: boolean;
  warnings: string[];
}

export interface WalletOptions {
  /** Extra collections to scan beyond the registry (e.g. a user's own list). */
  extraCollections?: string[];
  db?: Queryable | null;
  /** Override the chain client (tests). */
  client?: PublicClient;
  /** Time allowed for resolving metadata of tokens that are not cached yet. */
  metadataBudgetMs?: number;
}

const MAX_EXTRA = 10;
const key = (c: string, id: string) => `${c.toLowerCase()}:${id}`;

/**
 * All ERC-721 tokens `walletAddress` owns on `chainId`, each with image, token id, name, traits and verified status.
 *
 *  - Indexer database first when it is up (complete history, instant).
 *  - Direct chain discovery for everything the database does not cover (or all of it if the database is down).
 *  - Metadata resolved through the layered cache; a token whose gateways fail is still returned, flagged
 *    `meta: "unresolved"`, so the UI can show its fallback thumbnail instead of hiding the NFT.
 */
export async function getWalletNFTs(walletAddress: string, chainId: number, options: WalletOptions = {}): Promise<WalletNFTs> {
  if (!isAddress(walletAddress, { strict: false })) throw new Error("invalid address");
  const owner = walletAddress.toLowerCase();
  const client = options.client ?? getClient(chainId); // throws UnsupportedChainError
  const db = chainId === INDEXER_CHAIN_ID ? (options.db === undefined ? getDbOrNull() : options.db) : null;
  const extra = [...new Set((options.extraCollections ?? []).filter((a) => isAddress(a, { strict: false })).map((a) => a.toLowerCase()))].slice(0, MAX_EXTRA);

  const registry = await getRegistry(db, chainId);
  const warnings: string[] = [];
  let partial = false;

  type Row = { contract: string; tokenId: string; name: string | null; description: string | null; imageUri: string | null; traits: any[]; meta: MetaState };
  const rows = new Map<string, Row>();
  let usedDb = false;
  let usedChain = false;

  // ---- 1. indexer database ------------------------------------------------------------------------
  const coveredByDb = new Set<string>();
  if (db) {
    try {
      const { rows: r } = await db.query<any>(
        `SELECT t.contract, t.token_id::text AS token_id, t.name, t.description, COALESCE(t.image_uri, t.image_url) AS image_uri,
                t.attributes, t.meta_status
           FROM nft_tokens t JOIN nft_collections c ON c.address = t.contract
          WHERE t.owner = $1
          ORDER BY t.contract, t.token_id`,
        [owner],
      );
      const tracked = await db.query<{ address: string }>(
        `SELECT c.address FROM nft_collections c JOIN indexer_cursors i ON i.name = 'transfers'
          WHERE c.backfilled_to >= i.block AND c.backfilled_to >= c.start_block
            AND i.updated_at > now() - interval '60 seconds'`,
      );
      tracked.rows.forEach((x) => coveredByDb.add(x.address.toLowerCase()));
      for (const x of r) {
        rows.set(key(x.contract, x.token_id), {
          contract: x.contract, tokenId: x.token_id, name: x.name, description: x.description, imageUri: x.image_uri,
          traits: Array.isArray(x.attributes) ? x.attributes : [], meta: x.meta_status === "ok" ? "ok" : "pending",
        });
      }
      usedDb = true;
    } catch {
      markDbFailure();
      warnings.push("indexer unavailable; scanned the chain directly");
    }
  }

  // ---- 2. direct chain discovery for whatever the database does not cover ----------------------------
  const wanted = new Map<string, DiscoveryTarget>();
  for (const e of registry.values()) wanted.set(e.address, { address: e.address, startBlock: e.startBlock });
  for (const a of extra) if (!wanted.has(a)) wanted.set(a, { address: a, startBlock: 0n });
  const toScan = [...wanted.values()].filter((t) => !(usedDb && coveredByDb.has(t.address)));

  if (toScan.length) {
    const indexed = new Map(rows);
    const scanning = new Set(toScan.map((t) => t.address));
    // A stale/incomplete index must not keep showing tokens the wallet has already sold.
    for (const [k, row] of rows) if (scanning.has(row.contract.toLowerCase())) rows.delete(k);
    try {
      const found = await discoverOwnedTokens(client, owner, toScan);
      usedChain = true;
      partial ||= found.partial;
      warnings.push(...found.warnings);
      for (const t of found.tokens) {
        const k = key(t.contract, t.tokenId);
        if (!rows.has(k)) rows.set(k, indexed.get(k) ?? { contract: t.contract, tokenId: t.tokenId, name: null, description: null, imageUri: null, traits: [], meta: "pending" });
      }
    } catch (e) {
      partial = true;
      warnings.push(`chain discovery failed: ${e instanceof Error ? e.message.split("\n")[0] : "unknown error"}`);
    }
  }

  // ---- 3. resolve metadata for anything not yet resolved -----------------------------------------------
  const unresolved = [...rows.values()].filter((r) => r.meta !== "ok");
  if (unresolved.length) {
    const resolved = await getManyTokenMetadata(client, chainId, unresolved, { budgetMs: options.metadataBudgetMs ?? 3_000, db });
    for (const r of unresolved) {
      const m = resolved.get(key(r.contract, r.tokenId));
      if (m?.state === "ok") Object.assign(r, { name: m.name, description: m.description, imageUri: m.imageUri, traits: m.traits, meta: "ok" as const });
      else r.meta = "unresolved";
    }
    if (unresolved.some((r) => r.meta === "unresolved")) partial = true;
  }

  // ---- 4. assemble, verified/Chog first -----------------------------------------------------------------
  const chainNames = await getCollectionNames(client, [...new Set([...rows.values()].map((r) => r.contract))]);
  const nameOf = (e: RegistryEntry | undefined, contract: string) => e?.name ?? chainNames.get(contract.toLowerCase()) ?? null;
  const items = [...rows.values()]
    .map((r) => buildApiNft({ ...r, chainId, traits: r.traits, collection: registry.get(r.contract.toLowerCase()), collectionName: nameOf(registry.get(r.contract.toLowerCase()), r.contract) }))
    .sort((a, b) =>
      Number(b.isChog) - Number(a.isChog) || Number(b.verified) - Number(a.verified) ||
      a.contract.localeCompare(b.contract) || (BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : 1));

  return {
    address: owner, chainId, count: items.length, items,
    source: usedDb && usedChain ? "mixed" : usedDb ? "indexer" : "chain",
    partial, warnings,
  };
}
