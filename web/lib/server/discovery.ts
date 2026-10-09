import type { Address, PublicClient } from "viem";
import { nftReadAbi, transferEvent } from "./abi";
import { safeMulticall } from "./multicall";

export interface DiscoveryTarget {
  address: string;
  /** First block worth scanning for logs (collection deploy block, if known). */
  startBlock: bigint;
}

export interface OwnedToken {
  contract: string;
  tokenId: string;
}

export interface DiscoveryResult {
  tokens: OwnedToken[];
  /** True when something may be missing (budget, range limits, or more tokens than the cap). */
  partial: boolean;
  warnings: string[];
}

export interface DiscoveryOptions {
  /** Max tokens listed per collection via enumeration. */
  maxPerCollection: number;
  /** How far back (blocks) the log fallback looks. */
  logLookback: bigint;
  /** Largest and smallest eth_getLogs window; the window shrinks when the RPC rejects a range. */
  maxLogRange: bigint;
  minLogRange: bigint;
  /** Hard cap on getLogs requests per collection and on wall time overall. */
  maxLogRequests: number;
  deadlineMs: number;
}

export const DEFAULT_DISCOVERY: DiscoveryOptions = {
  maxPerCollection: 200,
  logLookback: BigInt(process.env.INVENTORY_LOG_LOOKBACK ?? 500_000),
  maxLogRange: BigInt(process.env.INVENTORY_LOG_MAX_RANGE ?? 50_000),
  minLogRange: 100n,
  maxLogRequests: 40,
  deadlineMs: 5_000,
};

type Reader = Pick<PublicClient, "getBlockNumber" | "multicall" | "getLogs" | "readContract">;

/**
 * Finds the tokens `owner` holds in the given collections, directly from the chain.
 *  1. one multicall of balanceOf over every collection (skips the ones with nothing)
 *  2. ERC721Enumerable: tokenOfOwnerByIndex, batched
 *  3. otherwise Transfer(to = owner) logs, newest window first, verified with ownerOf (a token that was received
 *     and later sold must not be listed)
 * Never throws for a single bad collection: that collection is reported in `warnings` and skipped.
 */
export async function discoverOwnedTokens(
  client: Reader,
  owner: string,
  targets: readonly DiscoveryTarget[],
  options: Partial<DiscoveryOptions> = {},
): Promise<DiscoveryResult> {
  const o = { ...DEFAULT_DISCOVERY, ...options };
  const deadline = Date.now() + o.deadlineMs;
  const result: DiscoveryResult = { tokens: [], partial: false, warnings: [] };
  if (targets.length === 0) return result;

  const balances = await safeMulticall(client, 
    targets.map((t) => ({ address: t.address as Address, abi: nftReadAbi, functionName: "balanceOf" as const, args: [owner as Address] as const })),
  );

  await Promise.all(
    targets.map(async (t, i) => {
      const b = balances[i]!;
      if (b.status !== "success") {
        result.warnings.push(`${t.address}: balanceOf failed (not an ERC-721?)`);
        return;
      }
      const balance = b.result as bigint;
      if (balance === 0n) return;

      try {
        const found = await enumerate(client, t.address, owner, balance, o);
        if (found) {
          result.tokens.push(...found.tokens.map((id) => ({ contract: t.address, tokenId: id })));
          if (found.truncated) {
            result.partial = true;
            result.warnings.push(`${t.address}: showing first ${o.maxPerCollection} of ${balance} tokens`);
          }
          return;
        }
        const viaLogs = await viaTransferLogs(client, t, owner, balance, o, deadline);
        result.tokens.push(...viaLogs.tokens.map((id) => ({ contract: t.address, tokenId: id })));
        if (viaLogs.tokens.length < Number(balance > BigInt(o.maxPerCollection) ? BigInt(o.maxPerCollection) : balance)) {
          result.partial = true;
          result.warnings.push(`${t.address}: found ${viaLogs.tokens.length} of ${balance} tokens (${viaLogs.reason})`);
        }
      } catch (e) {
        result.partial = true;
        result.warnings.push(`${t.address}: ${e instanceof Error ? e.message.split("\n")[0] : "discovery failed"}`);
      }
    }),
  );
  return result;
}

/** ERC721Enumerable path. Returns null when the collection does not support it. */
async function enumerate(client: Reader, contract: string, owner: string, balance: bigint, o: DiscoveryOptions) {
  const count = Number(balance > BigInt(o.maxPerCollection) ? BigInt(o.maxPerCollection) : balance);
  const res = await safeMulticall(
    client,
    Array.from({ length: count }, (_, i) => ({
      address: contract as Address, abi: nftReadAbi, functionName: "tokenOfOwnerByIndex" as const, args: [owner as Address, BigInt(i)] as const,
    })),
  );
  if (res.some((r) => r.status !== "success")) return null;
  return { tokens: res.map((r) => (r.result as bigint).toString()), truncated: balance > BigInt(count) };
}

const looksLikeRangeError = (e: unknown) => /range|limit|too many|exceed|block|response size|query returned more/i.test(e instanceof Error ? e.message : String(e));

async function viaTransferLogs(client: Reader, t: DiscoveryTarget, owner: string, balance: bigint, o: DiscoveryOptions, deadline: number) {
  const head = await client.getBlockNumber();
  const floor = head > o.logLookback ? head - o.logLookback : 0n;
  const lowest = t.startBlock > floor ? t.startBlock : floor;
  const want = balance > BigInt(o.maxPerCollection) ? BigInt(o.maxPerCollection) : balance;

  const owned = new Set<string>();
  const checked = new Set<string>();
  let window = o.maxLogRange;
  let to = head;
  let requests = 0;
  let reason = "scan complete";

  while (to >= lowest && BigInt(owned.size) < want) {
    if (requests >= o.maxLogRequests) { reason = "request budget reached"; break; }
    if (Date.now() > deadline) { reason = "time budget reached"; break; }

    const from = to - window + 1n > lowest ? to - window + 1n : lowest;
    let logs;
    requests++;
    try {
      logs = await client.getLogs({ address: t.address as Address, event: transferEvent, args: { to: owner as Address }, fromBlock: from, toBlock: to });
    } catch (e) {
      // The RPC rejected the window (range cap or too many results): retry the same end with a smaller window.
      if (looksLikeRangeError(e) && window > o.minLogRange) {
        window = window / 10n > o.minLogRange ? window / 10n : o.minLogRange;
        continue;
      }
      throw e;
    }

    const fresh = [...new Set(logs.map((l) => (l.args.tokenId as bigint).toString()))].filter((id) => !checked.has(id));
    if (fresh.length) {
      fresh.forEach((id) => checked.add(id));
      // Received is not owned: keep only tokens `owner` still holds.
      const verify = await safeMulticall(
        client,
        fresh.map((id) => ({ address: t.address as Address, abi: nftReadAbi, functionName: "ownerOf" as const, args: [BigInt(id)] as const })),
      );
      verify.forEach((r, i) => {
        if (r.status === "success" && (r.result as string).toLowerCase() === owner.toLowerCase()) owned.add(fresh[i]!);
      });
    }
    if (from === lowest) break;
    to = from - 1n;
  }
  if (to < lowest && BigInt(owned.size) < want) reason = `only the last ${o.logLookback} blocks were scanned`;
  return { tokens: [...owned], reason };
}
