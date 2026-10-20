import type { Address, PublicClient } from "viem";
import { sweeperAbi } from "./abi";
import { SWEEPER_ADDRESS, ZERO_ADDRESS } from "./config";
import type { SwapRecord, SwapStatus } from "./types";

// Contract enum: 0 None, 1 Active, 2 Accepted, 3 Cancelled, 4 Declined.
const STATUS_BY_INDEX: Record<number, SwapStatus | undefined> = { 1: "pending", 2: "completed", 3: "cancelled", 4: "declined" };

const BATCH = 50;

/**
 * The newest trades read straight from the contract (`tradeCount` + `getTrade`), with no log scanning: a handful of cheap
 * calls that work on any RPC, however long ago the contract was deployed. This is the fallback when the indexer is not
 * running. Settled trades have had their assets cleared by the contract, so those come back without assets (the indexer, or
 * the creation event, is the only source for them).
 */
export async function readRecentTrades(client: Pick<PublicClient, "readContract" | "multicall">, limit = 150): Promise<SwapRecord[]> {
  if (!SWEEPER_ADDRESS) return [];
  const count = (await client.readContract({ address: SWEEPER_ADDRESS, abi: sweeperAbi, functionName: "tradeCount" })) as bigint;
  if (count === 0n) return [];
  const first = count > BigInt(limit) ? count - BigInt(limit) + 1n : 1n;
  const ids: bigint[] = [];
  for (let id = count; id >= first; id--) ids.push(id);

  const now = Math.floor(Date.now() / 1000);
  const out: SwapRecord[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const rows = await client.multicall({
      allowFailure: false,
      contracts: slice.map((id) => ({ address: SWEEPER_ADDRESS!, abi: sweeperAbi, functionName: "getTrade" as const, args: [id] as const })),
    });
    rows.forEach((r, k) => {
      const [maker, taker, statusIndex, expiryRaw, offeredMon, wantedMon, fee, offered, wanted] = r;
      let status = STATUS_BY_INDEX[statusIndex];
      if (!status) return; // None: not a real trade
      const expiry = Number(expiryRaw);
      if (status === "pending" && expiry < now) status = "expired";
      out.push({
        id: slice[k]!,
        maker: maker as Address,
        taker: (taker as Address) ?? ZERO_ADDRESS,
        status,
        expiry,
        offeredMon,
        wantedMon,
        feePaid: status === "completed" ? fee : null,
        offered: offered.map((a) => ({ contract: a.nft, tokenId: a.tokenId })),
        wanted: wanted.map((a) => ({ contract: a.nft, tokenId: a.tokenId })),
      });
    });
  }
  return out;
}

/** Merge indexed marketplace records with the newest on-chain state. The indexer supplies metadata; chain state wins. */
export function mergePublicTrades(indexed: readonly SwapRecord[], onchain: readonly SwapRecord[], now = Math.floor(Date.now() / 1000)): SwapRecord[] {
  const liveChain = new Map(onchain.map((trade) => [trade.id.toString(), trade]));
  const merged = new Map<string, SwapRecord>();

  for (const trade of indexed) {
    const current = liveChain.get(trade.id.toString());
    merged.set(trade.id.toString(), current ? { ...trade, status: current.status, taker: current.taker, expiry: current.expiry } : trade);
  }
  for (const trade of onchain) {
    const id = trade.id.toString();
    if (!merged.has(id)) merged.set(id, trade);
  }

  return [...merged.values()]
    .filter((trade) => trade.status === "pending" && trade.taker.toLowerCase() === ZERO_ADDRESS && trade.expiry > now)
    .sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));
}
