"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { fetchTradesFromApi } from "./api";
import { readRecentTrades } from "./chainTrades";
import { SWEEPER_ADDRESS, ZERO_ADDRESS, monadTestnet } from "./config";
import type { SwapRecord } from "./types";

export interface ActivityItem {
  id: string;
  status: "pending" | "completed" | "cancelled" | "declined" | "expired";
  at: string;
  maker: string;
  taker: string | null;
  assetCount: number;
  monWei: string;
  first: { name: string | null; image: string | null; imageFallbacks: string[]; collectionName: string | null; verified: boolean; tokenId: string; contract: string } | null;
}

export interface SiteStats {
  totals: { trades: number; completed: number; open: number; traders: number; last24h: number; volumeWei: string; verifiedCollections: number };
  recent: ActivityItem[];
  generatedAt: string;
}

export interface SiteStatus {
  level: "operational" | "degraded" | "outage";
  message: string;
  rpc: { ok: boolean; head: string | null; ms: number | null };
  indexer: { ok: boolean | null; lagBlocks: number | null };
}

const json = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json() as Promise<T>;
};

/** Marketplace totals and recent activity. Errors when the indexer database is unavailable: callers show an "offline" state. */
export const useStats = () =>
  useQuery({ queryKey: ["site-stats"], queryFn: () => json<SiteStats>("/api/stats"), refetchInterval: 20_000, retry: 1, staleTime: 10_000 });

/** Open Counter offers anyone can accept. Indexer API first; without it, the newest still-open public trades read from the contract. */
export function usePublicOffers() {
  const client = usePublicClient({ chainId: monadTestnet.id });
  return useQuery<SwapRecord[]>({
    queryKey: ["public-offers"],
    refetchInterval: 15_000,
    retry: 1,
    queryFn: async () => {
      try {
        return await fetchTradesFromApi(undefined, "public");
      } catch (e) {
        if (!SWEEPER_ADDRESS || !client) throw e;
        return (await readRecentTrades(client)).filter((t) => t.status === "pending" && t.taker === ZERO_ADDRESS);
      }
    },
  });
}

export interface VerifiedCollection {
  address: string;
  name: string | null;
  ecosystem: "chog" | "monad" | null;
  isChog: boolean;
}

/** The verified collection registry (Chog first). */
export const useVerifiedCollections = () =>
  useQuery({ queryKey: ["verified-collections"], queryFn: async () => (await json<{ collections: VerifiedCollection[] }>("/api/collections")).collections, staleTime: 60_000, retry: 1 });

export const useSiteStatus = () =>
  useQuery({ queryKey: ["site-status"], queryFn: () => json<SiteStatus>("/api/status"), refetchInterval: 30_000, retry: 0, staleTime: 15_000 });
