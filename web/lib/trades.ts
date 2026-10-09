import type { Address } from "viem";
import { ZERO_ADDRESS } from "./config";
import { sameAddress } from "./format";
import type { SwapRecord } from "./types";

export interface TradeLists {
  /** Direct offers addressed to the user that can still be accepted. */
  incoming: SwapRecord[];
  /** The user's own open offers, including expired ones the maker must still cancel. */
  outgoing: SwapRecord[];
  history: SwapRecord[];
}

const FINISHED = new Set(["completed", "cancelled", "declined"]);

/** Client-side equivalent of the indexer's incoming/outgoing/history queries (used by the chain fallback). */
export function partitionTrades(all: readonly SwapRecord[], me: Address): TradeLists {
  const byNewest = (a: SwapRecord, b: SwapRecord) => (a.id < b.id ? 1 : -1);
  const involved = (t: SwapRecord) => sameAddress(t.maker, me) || sameAddress(t.taker, me);
  return {
    incoming: all.filter((t) => !sameAddress(t.maker, me) && t.taker !== ZERO_ADDRESS && sameAddress(t.taker, me) && t.status === "pending").sort(byNewest),
    outgoing: all.filter((t) => sameAddress(t.maker, me) && (t.status === "pending" || t.status === "expired")).sort(byNewest),
    history: all.filter((t) => involved(t) && FINISHED.has(t.status)).sort(byNewest),
  };
}
