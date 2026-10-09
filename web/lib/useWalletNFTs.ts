"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAddress, type Address } from "viem";
import { fetchInventoryFromApi, resolveTokenFromApi, ResolveError } from "./api";
import { monadTestnet } from "./config";
import { nftKey, sameAddress, shortAddress } from "./format";
import type { NFTItem } from "./types";

export interface UseWalletNFTsOptions {
  /** Maximum selectable tokens (the contract allows 10 per side). */
  max?: number;
  /** Extra collections to scan beyond the verified registry (e.g. ones the user tracks). */
  collections?: readonly Address[];
  enabled?: boolean;
  chainId?: number;
}

export type AddTokenResult = { ok: true; item: NFTItem } | { ok: false; error: string };

interface CustomRef {
  contract: Address;
  tokenId: string;
}

const customKey = (chainId: number, owner: string) => `chogsweeper:custom-tokens:${chainId}:${owner.toLowerCase()}`;

function loadCustom(chainId: number, owner: string): CustomRef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(customKey(chainId, owner)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((r) => r && isAddress(r.contract) && /^\d+$/.test(String(r.tokenId))).slice(0, 50) : [];
  } catch {
    return [];
  }
}

function saveCustom(chainId: number, owner: string, refs: CustomRef[]) {
  try {
    localStorage.setItem(customKey(chainId, owner), JSON.stringify(refs));
  } catch {
    /* storage unavailable: the token stays for this session only */
  }
}

/**
 * Everything a wallet holds, ready for the trade builder:
 *  - discovered tokens (indexer + chain) with images, names, traits and verified status
 *  - tokens the user added by hand (contract + token ID), re-checked for ownership on every load
 *  - multi-select state with a size cap
 *
 * `isLoading` is true only for the first load (render skeletons); `isFetching` covers background refreshes.
 */
export function useWalletNFTs(address: Address | undefined, options: UseWalletNFTsOptions = {}) {
  const { max = 10, collections, enabled = true, chainId = monadTestnet.id } = options;
  const collectionsKey = (collections ?? []).map((c) => c.toLowerCase()).sort().join(",");

  // ---- discovered ----------------------------------------------------------------------------------
  const discovered = useQuery({
    queryKey: ["wallet-nfts", chainId, address?.toLowerCase(), collectionsKey],
    enabled: enabled && !!address,
    staleTime: 30_000,
    retry: 1,
    queryFn: () => fetchInventoryFromApi(address!, { chainId, collections }),
  });

  // ---- manually added -------------------------------------------------------------------------------
  const [refs, setRefs] = useState<CustomRef[]>([]);
  useEffect(() => setRefs(address ? loadCustom(chainId, address) : []), [address, chainId]);

  const customQuery = useQuery({
    queryKey: ["custom-nfts", chainId, address?.toLowerCase(), refs.map((r) => `${r.contract}:${r.tokenId}`).join(",")],
    enabled: enabled && !!address && refs.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const settled = await Promise.allSettled(refs.map((r) => resolveTokenFromApi(r.contract, r.tokenId, chainId)));
      // A token that moved to someone else is no longer this wallet's to offer: hide it quietly.
      return settled.flatMap((s) => (s.status === "fulfilled" && sameAddress(s.value.owner, address) ? [s.value.item] : []));
    },
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: NFTItem[] = [];
    for (const i of [...(discovered.data?.items ?? []), ...(customQuery.data ?? [])]) {
      const k = nftKey(i);
      if (!seen.has(k)) (seen.add(k), out.push(i));
    }
    return out;
  }, [discovered.data, customQuery.data]);

  const addToken = useCallback(
    async (contractInput: string, tokenIdInput: string): Promise<AddTokenResult> => {
      const contract = contractInput.trim();
      const tokenId = tokenIdInput.trim();
      if (!address) return { ok: false, error: "Connect a wallet or enter a target address first." };
      if (!isAddress(contract, { strict: false })) return { ok: false, error: "Enter a valid contract address (0x…)." };
      if (!/^\d{1,78}$/.test(tokenId)) return { ok: false, error: "Token ID must be a whole number." };
      try {
        const { item, owner } = await resolveTokenFromApi(contract.toLowerCase(), tokenId, chainId);
        if (!sameAddress(owner, address)) {
          return { ok: false, error: `This token is owned by ${shortAddress(owner)}, not ${shortAddress(address)}.` };
        }
        setRefs((prev) => {
          if (prev.some((r) => r.contract.toLowerCase() === contract.toLowerCase() && r.tokenId === tokenId)) return prev;
          const next = [...prev, { contract: contract.toLowerCase() as Address, tokenId }];
          saveCustom(chainId, address, next);
          return next;
        });
        return { ok: true, item };
      } catch (e) {
        return { ok: false, error: e instanceof ResolveError ? e.message : "Lookup failed. Try again." };
      }
    },
    [address, chainId],
  );

  const removeToken = useCallback(
    (item: NFTItem) => {
      if (!address) return;
      setRefs((prev) => {
        const next = prev.filter((r) => !(r.contract.toLowerCase() === item.contract.toLowerCase() && r.tokenId === item.tokenId.toString()));
        saveCustom(chainId, address, next);
        return next;
      });
      setSelection((m) => {
        const n = new Map(m);
        n.delete(nftKey(item));
        return n;
      });
    },
    [address, chainId],
  );

  // ---- selection -------------------------------------------------------------------------------------
  const [selection, setSelection] = useState<Map<string, NFTItem>>(new Map());
  // A different wallet means a different set of tokens: never carry a selection across.
  useEffect(() => setSelection(new Map()), [address, chainId]);

  const toggle = useCallback(
    (item: NFTItem) =>
      setSelection((m) => {
        const k = nftKey(item);
        const next = new Map(m);
        if (next.has(k)) next.delete(k);
        else if (next.size < max) next.set(k, item);
        return next;
      }),
    [max],
  );
  const clear = useCallback(() => setSelection(new Map()), []);

  // Drop selected tokens that are no longer in the list (sold, transferred away, removed).
  useEffect(() => {
    if (!discovered.data && !customQuery.data) return;
    const live = new Set(items.map(nftKey));
    setSelection((m) => {
      const stale = [...m.keys()].filter((k) => !live.has(k));
      if (!stale.length) return m;
      const next = new Map(m);
      stale.forEach((k) => next.delete(k));
      return next;
    });
  }, [items, discovered.data, customQuery.data]);

  return {
    items,
    isLoading: discovered.isLoading && !!address,
    isFetching: discovered.isFetching || customQuery.isFetching,
    isError: discovered.isError,
    /** Some tokens may be missing or lack metadata. */
    partial: discovered.data?.partial ?? false,
    warnings: discovered.data?.warnings ?? [],
    source: discovered.data?.source ?? null,
    refetch: () => Promise.all([discovered.refetch(), customQuery.refetch()]).then(() => undefined),

    selectedKeys: useMemo(() => new Set(selection.keys()), [selection]),
    selectedItems: useMemo(() => [...selection.values()], [selection]),
    isSelected: (item: NFTItem) => selection.has(nftKey(item)),
    toggle,
    clear,
    max,

    addToken,
    removeToken,
  };
}

export type WalletNFTs = ReturnType<typeof useWalletNFTs>;
