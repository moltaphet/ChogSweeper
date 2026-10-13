"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, isAddress, type Address, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { readRecentTrades } from "./chainTrades";
import { usePublicClient } from "wagmi";
import { CHOG_COLLECTION, DEFAULT_COLLECTIONS, DEPLOY_BLOCK, SWEEPER_ADDRESS, ZERO_ADDRESS, monadTestnet } from "./config";
import { fetchTradesFromApi } from "./api";
import { partitionTrades, type TradeLists } from "./trades";
import type { SwapRecord } from "./types";

const STORAGE_KEY = "chogsweeper:collections";

/** Collections to scan: Chog first, then env defaults, then user-added ones (kept in localStorage). */
export function useCollections() {
  const [custom, setCustom] = useState<Address[]>([]);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(raw)) setCustom(raw.filter((s: string) => isAddress(s)) as Address[]);
    } catch {
      /* storage unavailable: start empty */
    }
  }, []);

  const add = useCallback((a: Address) => {
    setCustom((prev) => {
      if (prev.some((p) => p.toLowerCase() === a.toLowerCase())) return prev;
      const next = [...prev, a];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const all = [...(CHOG_COLLECTION ? [CHOG_COLLECTION] : []), ...DEFAULT_COLLECTIONS, ...custom];
  const unique = all.filter((a, i) => all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i);
  return { collections: unique, add };
}

const ensClient = createPublicClient({ chain: mainnet, transport: http(process.env.NEXT_PUBLIC_ENS_RPC_URL) });

export type Resolution =
  | { state: "empty" }
  | { state: "loading" }
  | { state: "invalid" }
  | { state: "ok"; address: Address; fromName: string | null };

/** Resolves a 0x address or an ENS name (best effort, via Ethereum mainnet) to an address. */
export function useResolvedAddress(input: string): Resolution {
  const value = input.trim();
  const direct = isAddress(value);
  const looksLikeName = !direct && value.includes(".");

  const q = useQuery({
    queryKey: ["ens", value],
    enabled: looksLikeName,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        return await ensClient.getEnsAddress({ name: normalize(value) });
      } catch {
        return null;
      }
    },
  });

  if (!value) return { state: "empty" };
  if (direct) return { state: "ok", address: value as Address, fromName: null };
  if (!looksLikeName) return { state: "invalid" };
  if (q.isLoading) return { state: "loading" };
  return q.data ? { state: "ok", address: q.data, fromName: value } : { state: "invalid" };
}

/**
 * Fallback when the indexer is unreachable: read the newest trades straight from the contract (no log scanning, so it stays
 * fast however old the deployment is) and keep the ones this user is part of.
 */
async function fetchTradesFromChain(client: PublicClient, user: Address): Promise<SwapRecord[]> {
  const all = await readRecentTrades(client);
  const me = user.toLowerCase();
  return all.filter((t) => t.maker.toLowerCase() === me || t.taker.toLowerCase() === me);
}

export type TradesResult = TradeLists & { source: "indexer" | "chain" };

/** All of a user's trades split into incoming / outgoing / history. Indexer API first, chain logs as fallback. */
export function useTrades(user: Address | undefined) {
  const client = usePublicClient({ chainId: monadTestnet.id });
  return useQuery({
    queryKey: ["trades", user],
    enabled: !!user && !!client,
    refetchInterval: 8_000,
    queryFn: async (): Promise<TradesResult> => {
      try {
        const [incoming, outgoing, history] = await Promise.all(
          (["incoming", "outgoing", "history"] as const).map((t) => fetchTradesFromApi(user!, t)),
        );
        return { incoming: incoming!, outgoing: outgoing!, history: history!, source: "indexer" };
      } catch {
        if (!SWEEPER_ADDRESS) return { incoming: [], outgoing: [], history: [], source: "chain" };
        return { ...partitionTrades(await fetchTradesFromChain(client!, user!), user!), source: "chain" };
      }
    },
  });
}
