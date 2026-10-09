import { isAddress } from "viem";
import { CHOG_COLLECTION } from "../config";
import { markDbFailure } from "./db";
import type { Queryable } from "./queryable";

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
  const add = (address: string, eco: Ecosystem | null, startBlock = 0n, name: string | null = null) => {
    if (!isAddress(address, { strict: false })) return;
    const key = lower(address);
    const prev = out.get(key);
    const ecosystem = eco ?? prev?.ecosystem ?? null;
    out.set(key, { address: key, name: prev?.name ?? name, isChog: ecosystem === "chog", verified: ecosystem !== null, ecosystem, startBlock: prev?.startBlock ?? startBlock });
  };
  for (const c of (env.NEXT_PUBLIC_COLLECTIONS ?? "").split(",")) if (c.trim()) add(c.trim(), null);
  for (const entry of (env.VERIFIED_COLLECTIONS ?? "").split(",")) {
    const [a, eco, start] = entry.trim().split(":");
    if (a && (eco === "chog" || eco === "monad")) add(a, eco, BigInt(start || 0));
  }
  const chog = env.NEXT_PUBLIC_CHOG_COLLECTION ?? CHOG_COLLECTION ?? undefined;
  if (chog) add(chog, "chog");
  return out;
}

const TTL_MS = 30_000;
let cache: { at: number; value: Map<string, RegistryEntry> } | null = null;

/** DB registry (authoritative when the indexer is up) layered over the env registry. Cached for 30s. */
export async function getRegistry(db: Queryable | null): Promise<Map<string, RegistryEntry>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
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
  cache = { at: Date.now(), value: merged };
  return merged;
}

export function resetRegistryCache() {
  cache = null;
}
