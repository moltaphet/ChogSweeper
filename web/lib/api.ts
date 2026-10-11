import type { Address } from "viem";
import { monadTestnet, ZERO_ADDRESS } from "./config";
import { chogImageFor } from "./chogArt";
import type { Ecosystem, MetaState, NFTItem, NFTTrait, SwapRecord, SwapStatus, TradeAsset } from "./types";

export type TradeListType = "incoming" | "outgoing" | "history" | "public";

interface ApiAsset {
  contract: Address;
  tokenId: string;
  name: string | null;
  image: string | null;
  imageFallbacks?: string[];
  collectionName: string | null;
  isChog: boolean;
  verified: boolean;
  ecosystem: Ecosystem | null;
}

interface ApiSwap {
  id: string;
  maker: Address;
  taker: Address | null;
  status: SwapStatus;
  offeredMon: string;
  wantedMon: string;
  offered: ApiAsset[];
  wanted: ApiAsset[];
  expiry: string;
  createdTx: string;
  settledTx: string | null;
  feePaid: string | null;
}

interface ApiNft {
  contract: Address;
  tokenId: string;
  name: string;
  description: string | null;
  collectionName: string;
  image: string | null;
  imageFallbacks: string[];
  isChog: boolean;
  verified: boolean;
  ecosystem: Ecosystem | null;
  traits: NFTTrait[];
  meta: MetaState;
}

const TIMEOUT_MS = 5000;
const TESTNET = monadTestnet.testnet === true;

async function getJson<T>(url: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * On the testnet the "Chog" collection is our own mock, whose on-chain image is a plain placeholder. There we show the
 * official artwork instead (the original image stays as the fallback). On mainnet the real collection's own images are used.
 */
const chogArt = (isChog: boolean, tokenId: string, image: string | null, fallbacks: string[] = []) =>
  isChog && TESTNET ? { image: chogImageFor(BigInt(tokenId)), imageFallbacks: [...(image ? [image] : []), ...fallbacks] } : { image, imageFallbacks: fallbacks };

const toAsset = (a: ApiAsset): TradeAsset => ({
  contract: a.contract,
  tokenId: BigInt(a.tokenId),
  name: a.name ?? undefined,
  collectionName: a.collectionName ?? undefined,
  ...chogArt(a.isChog, a.tokenId, a.image, a.imageFallbacks),
  isChog: a.isChog,
  verified: a.verified,
  ecosystem: a.ecosystem,
});

export function fromApiSwap(s: ApiSwap): SwapRecord {
  return {
    id: BigInt(s.id),
    maker: s.maker,
    taker: s.taker ?? ZERO_ADDRESS,
    status: s.status,
    expiry: Math.floor(new Date(s.expiry).getTime() / 1000),
    offeredMon: BigInt(s.offeredMon),
    wantedMon: BigInt(s.wantedMon),
    offered: s.offered.map(toAsset),
    wanted: s.wanted.map(toAsset),
    createdTx: s.createdTx,
    settledTx: s.settledTx,
    feePaid: s.feePaid === null ? null : BigInt(s.feePaid),
  };
}

export async function fetchTradesFromApi(user: Address | undefined, type: TradeListType): Promise<SwapRecord[]> {
  const body = await getJson<{ swaps: ApiSwap[] }>(`/api/swaps?${user ? `user=${user}&` : ""}type=${type}&limit=100`);
  return body.swaps.map(fromApiSwap);
}

export const toNftItem = (i: ApiNft): NFTItem => ({
  contract: i.contract,
  tokenId: BigInt(i.tokenId),
  name: i.name,
  description: i.description,
  collectionName: i.collectionName,
  ...chogArt(i.isChog, i.tokenId, i.image, i.imageFallbacks),
  isChog: i.isChog,
  verified: i.verified,
  ecosystem: i.ecosystem,
  traits: i.traits ?? [],
  meta: i.meta,
});

export interface InventoryResult {
  items: NFTItem[];
  /** Something may be missing or unresolved; the UI nudges towards "add manually" / retry. */
  partial: boolean;
  warnings: string[];
  source: "indexer" | "chain" | "mixed";
}

export async function fetchInventoryFromApi(owner: Address, opts: { chainId?: number; collections?: readonly Address[] } = {}): Promise<InventoryResult> {
  const q = new URLSearchParams({ address: owner });
  if (opts.chainId) q.set("chainId", String(opts.chainId));
  if (opts.collections?.length) q.set("collections", opts.collections.slice(0, 10).join(","));
  const body = await getJson<{ items: ApiNft[]; partial: boolean; warnings: string[]; source: InventoryResult["source"] }>(`/api/wallet/inventory?${q}`, 20_000);
  return { items: body.items.map(toNftItem), partial: body.partial, warnings: body.warnings ?? [], source: body.source };
}

export interface ResolvedToken {
  item: NFTItem;
  /** Lowercase current owner address. */
  owner: string;
}

export class ResolveError extends Error {}

/** Resolves one token by contract + id (manual add). Throws ResolveError with a user-presentable message. */
export async function resolveTokenFromApi(contract: string, tokenId: string, chainId?: number): Promise<ResolvedToken> {
  const q = new URLSearchParams({ contract, tokenId });
  if (chainId) q.set("chainId", String(chainId));
  let res: Response;
  try {
    res = await fetch(`/api/nft/resolve?${q}`, { signal: AbortSignal.timeout(25_000) });
  } catch {
    throw new ResolveError("Could not reach the server. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as ApiNft & { owner?: string | null; error?: string; tradeable?: boolean };
  if (!res.ok) throw new ResolveError(res.status === 429 ? "Too many requests. Wait a moment and try again." : (body.error ?? `Lookup failed (${res.status})`));
  if (body.tradeable === false) throw new ResolveError(body.error ?? "This token cannot be traded here.");
  return { item: { ...toNftItem(body), custom: true }, owner: String(body.owner ?? "").toLowerCase() };
}
