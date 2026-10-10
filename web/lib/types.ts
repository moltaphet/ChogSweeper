import type { Address } from "viem";

/** A single ERC-721 token as displayed and selected in the UI. */
export type Ecosystem = "chog" | "monad";

export interface NFTTrait {
  readonly trait_type: string;
  readonly value: string;
}

/** `ok` = metadata resolved; `unresolved` = the token exists but its metadata/image could not be fetched. */
export type MetaState = "ok" | "pending" | "unresolved";

export interface NFTItem {
  readonly contract: Address;
  readonly tokenId: bigint;
  readonly name: string;
  readonly collectionName: string;
  /** Resolved http(s) image URL, or null when metadata is unavailable. */
  readonly image: string | null;
  /** Alternate URLs for the same image (other IPFS/Arweave gateways), tried in order if `image` fails. */
  readonly imageFallbacks: readonly string[];
  readonly description: string | null;
  readonly traits: readonly NFTTrait[];
  readonly meta: MetaState;
  /** Added by the user via contract + token ID rather than discovered. */
  readonly custom?: boolean;
  /** True for tokens of the Chog collection, which are sorted first. */
  readonly isChog: boolean;
  /** Collection is in the verified registry (Chog or Monad ecosystem). */
  readonly verified: boolean;
  readonly ecosystem: Ecosystem | null;
}

/** Minimal on-chain reference to a token, as sent to the contract. */
export type NFTRef = Pick<NFTItem, "contract" | "tokenId">;

/** Everything `createSwap` needs. Amounts are in wei. */
export interface SwapOffer {
  /** Designated taker, or the zero address for an open swap. */
  readonly taker: Address;
  readonly offered: readonly NFTRef[];
  readonly offeredMon: bigint;
  readonly wanted: readonly NFTRef[];
  readonly wantedMon: bigint;
  /** Unix timestamp in seconds. */
  readonly expiry: number;
}

export type SwapStatus = "pending" | "completed" | "cancelled" | "declined" | "expired";

/** A token inside a trade. Metadata is optional: it is absent when only chain data is available. */
export type TradeAsset = NFTRef & Partial<Omit<NFTItem, "contract" | "tokenId">>;

/** A trade as shown in Requests, History and the detail modal. */
export interface SwapRecord extends Omit<SwapOffer, "offered" | "wanted"> {
  readonly id: bigint;
  readonly maker: Address;
  readonly status: SwapStatus;
  readonly offered: readonly TradeAsset[];
  readonly wanted: readonly TradeAsset[];
  readonly createdBlock?: bigint;
  readonly createdTx?: string;
  readonly settledTx?: string | null;
  /** Fee the maker paid at creation, kept by the platform on acceptance; only known after acceptance. */
  readonly feePaid?: bigint | null;
}
