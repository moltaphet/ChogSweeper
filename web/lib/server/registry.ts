import { isAddress } from "viem";
import { CHOG_COLLECTION } from "../config";
import { DEPLOYED_TEST_COLLECTIONS } from "../generated/testCollections";
import { markDbFailure } from "./db";
import type { Queryable } from "./queryable";
import { INDEXER_CHAIN_ID } from "./chains";

export type Ecosystem = "chog" | "monad";

export interface RegistryEntry {
  address: string; // lowercase
  name: string | null;
  isChog: boolean;
  verified: boolean;
  ecosystem: Ecosystem | null;
  startBlock: bigint;
}

const lower = (a: string) => a.toLowerCase();

/** Registry from env: CHOG collection, VERIFIED_COLLECTIONS=addr:ecosystem[:startBlock], NEXT_PUBLIC_COLLECTIONS (tracked, unverified). */
export function registryFromEnv(env: Record<string, string | undefined> = process.env): Map<string, RegistryEntry> {
  const out = new Map<string, RegistryEntry>();
  const add = (address: string, eco: Ecosystem | null, startBlock?: bigint, name: string | null = null) => {
    if (!isAddress(address, { strict: false })) return;
    const key = lower(address);
    const prev = out.get(key);
    const ecosystem = eco ?? prev?.ecosystem ?? null;
    out.set(key, { address: key, name: prev?.name ?? name, isChog: ecosystem === "chog", verified: ecosystem !== null, ecosystem, startBlock: startBlock ?? prev?.startBlock ?? 0n });
  };
  for (const c of (env.NEXT_PUBLIC_COLLECTIONS ?? "").split(",")) if (c.trim()) add(c.trim(), null);
  for (const entry of (env.VERIFIED_COLLECTIONS ?? "").split(",")) {
    const [a, eco, start] = entry.trim().split(":");
    if (a && (eco === "chog" || eco === "monad") && (!start || /^\d+$/.test(start))) add(a, eco, BigInt(start || 0));
  }
  const chog = env.NEXT_PUBLIC_CHOG_COLLECTION ?? CHOG_COLLECTION ?? undefined;
  if (chog) add(chog, "chog");
  // These are testnet-only deployments exported from deployments/10143.json. Keep wallet discovery and
  // the live allowlist-aware UI working even when a hosting provider has not copied fresh env values yet.
  if (INDEXER_CHAIN_ID === 10143) {
    if (DEPLOYED_TEST_COLLECTIONS.chog) add(DEPLOYED_TEST_COLLECTIONS.chog, "chog", undefined, "Mock Chog");
    if (DEPLOYED_TEST_COLLECTIONS.r3tards) add(DEPLOYED_TEST_COLLECTIONS.r3tards, "monad", undefined, "Test r3tards");
    if (DEPLOYED_TEST_COLLECTIONS.skrumpeys) add(DEPLOYED_TEST_COLLECTIONS.skrumpeys, "monad", undefined, "Test skrumpeys");
    if (DEPLOYED_TEST_COLLECTIONS.theBobs) add(DEPLOYED_TEST_COLLECTIONS.theBobs, "monad", undefined, "Test The Bobs");
  }
  return out;
}

const TTL_MS = 30_000;
let cache: { at: number; db: Queryable | null; value: Map<string, RegistryEntry> } | null = null;

/** DB registry (authoritative when the indexer is up) layered over the env registry. Cached for 30s. */
export async function getRegistry(db: Queryable | null, chainId = INDEXER_CHAIN_ID): Promise<Map<string, RegistryEntry>> {
  // The configured registry belongs to one chain; equal addresses elsewhere do not imply verification.
  if (chainId !== INDEXER_CHAIN_ID) return new Map();
  if (cache && cache.db === db && Date.now() - cache.at < TTL_MS) return cache.value;
  const merged = registryFromEnv();
  if (db) {
    try {
      const { rows } = await db.query<any>("SELECT address, name, is_chog, verified, ecosystem, start_block::text AS start_block FROM nft_collections");
      for (const r of rows) {
        merged.set(lower(r.address), {
          address: lower(r.address), name: r.name, isChog: !!r.is_chog, verified: !!r.verified,
          ecosystem: r.ecosystem ?? null, startBlock: BigInt(r.start_block ?? 0),
        });
      }
    } catch {
      markDbFailure(); // fall back to env-only registry
    }
  }
  cache = { at: Date.now(), db, value: merged };
  return merged;
}

export function resetRegistryCache() {
  cache = null;
}
