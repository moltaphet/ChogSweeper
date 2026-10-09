import { Redis } from "@upstash/redis";

const g = globalThis as unknown as { __redis?: Redis | null };

export function getRedis(): Redis | null {
  if (g.__redis === undefined) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    g.__redis = url && token ? new Redis({ url, token }) : null;
  }
  return g.__redis;
}

/** Same layout the indexer invalidates: one hash per wallet, one field per collection filter. */
export const inventoryKey = (wallet: string) => `inv:${wallet.toLowerCase()}`;
export const INVENTORY_TTL_SECONDS = 120;
