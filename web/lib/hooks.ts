"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, isAddress, type Address, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { getLogsChunked } from "./chainLogs";
import { usePublicClient } from "wagmi";
import { sweeperAbi } from "./abi";
import { CHOG_COLLECTION, DEFAULT_COLLECTIONS, DEPLOY_BLOCK, SWEEPER_ADDRESS, ZERO_ADDRESS, monadTestnet } from "./config";
import { fetchTradesFromApi } from "./api";
import { partitionTrades, type TradeLists } from "./trades";
import type { SwapRecord, SwapStatus } from "./types";

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

// Contract enum: 0 None, 1 Active, 2 Accepted, 3 Cancelled, 4 Declined.
// Contract enum: 0 None, 1 Active, 2 Accepted, 3 Cancelled, 4 Declined.
const STATUS_BY_INDEX: Record<number, SwapStatus | undefined> = { 1: "pending", 2: "completed", 3: "cancelled", 4: "declined" };

/** Fallback when the indexer is unreachable: rebuild the user's trades from contract logs. */
async function fetchTradesFromChain(client: PublicClient, user: Address): Promise<SwapRecord[]> {
  const event = sweeperAbi.find((x) => x.type === "event" && x.name === "TradeCreated")!;
  const [asMaker, asTaker] = await Promise.all(
    [{ maker: user }, { taker: user }].map((args) =>
      getLogsChunked(client, (fromBlock, toBlock) => client.getLogs({ address: SWEEPER_ADDRESS!, event, args, fromBlock, toBlock }), DEPLOY_BLOCK),
    ),
  );
  type Created = { id: bigint; block: bigint; args: (typeof asMaker)[number]["args"] };
  const seen = new Map<string, Created>();
  for (const l of [...asMaker, ...asTaker]) {
    const id = l.args.tradeId as bigint;
    seen.set(id.toString(), { id, block: l.blockNumber, args: l.args });
  }
  const entries = [...seen.values()];
  if (entries.length === 0) return [];

  // Assets come from the creation event (the contract clears them on settlement); only status needs a read.
  const results = await client.multicall({
    allowFailure: false,
    contracts: entries.map((e) => ({ address: SWEEPER_ADDRESS!, abi: sweeperAbi, functionName: "getTrade" as const, args: [e.id] as const })),
  });
  const now = Math.floor(Date.now() / 1000);
  return results.map((r, i): SwapRecord => {
    const e = entries[i]!;
    const expiry = Number(e.args.expiry);
    let status = STATUS_BY_INDEX[r[2]] ?? "cancelled";
    if (status === "pending" && expiry < now) status = "expired";
    return {
      id: e.id,
      createdBlock: e.block,
      maker: e.args.maker as Address,
      taker: (e.args.taker as Address | undefined) ?? ZERO_ADDRESS,
      status,
      expiry,
      offeredMon: e.args.offeredMon as bigint,
      wantedMon: e.args.wantedMon as bigint,
      offered: (e.args.offered ?? []).map((a) => ({ contract: a.nft, tokenId: a.tokenId })),
      wanted: (e.args.wanted ?? []).map((a) => ({ contract: a.nft, tokenId: a.tokenId })),
    };
  });
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
