import { Redis } from "@upstash/redis";
import { log } from "./log.js";

export interface InventoryCache {
  /** Drops every cached inventory view (all collection filters) for these wallets. */
  invalidate(wallets: readonly string[]): Promise<void>;
}

/** Key layout shared with the web API: one hash per wallet, one field per collection filter. */
export const inventoryKey = (wallet: string) => `inv:${wallet.toLowerCase()}`;

export function createInventoryCache(cfg: { url: string; token: string } | null): InventoryCache {
  if (!cfg) return { invalidate: async () => {} };
  const redis = new Redis(cfg);
  return {
    async invalidate(wallets) {
      if (wallets.length === 0) return;
      try {
        await redis.del(...wallets.map(inventoryKey));
      } catch (e) {
        // A stale cache entry expires on its own TTL, so this is never fatal.
        log.warn("cache invalidation failed", { err: String(e) });
      }
    },
  };
}
