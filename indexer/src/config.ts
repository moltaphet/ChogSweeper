import { isAddress, type Address } from "viem";
import { withGateways } from "./nft-resolver.js";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}
const num = (name: string, d: number, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : d;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
};
const block = (raw: string | undefined, name: string) => {
  if (raw && !/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative block number`);
  return BigInt(raw || 0);
};
const endpoint = (raw: string, name: string, protocols: string[]) => {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${name} must contain valid URLs`); }
  if (!protocols.includes(url.protocol)) throw new Error(`${name} has an unsupported URL protocol`);
  return raw;
};
const addr = (v: string, what: string): Address => {
  if (!isAddress(v, { strict: false })) throw new Error(`Invalid address for ${what}: ${v}`);
  return v.toLowerCase() as Address;
};

export type Ecosystem = "chog" | "monad";

export interface CollectionSeed {
  address: Address;
  startBlock: bigint;
  /** Set => the collection is verified as part of that ecosystem. */
  ecosystem: Ecosystem | null;
}

export function loadConfig() {
  const collections: CollectionSeed[] = (process.env.COLLECTIONS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      // address[:startBlock[:ecosystem]]   e.g. 0xabc…:1200000:monad
      const [a, start, eco] = entry.split(":");
      if (eco && eco !== "chog" && eco !== "monad") throw new Error(`Unknown ecosystem "${eco}" in COLLECTIONS`);
      return { address: addr(a!, "COLLECTIONS"), startBlock: block(start, "COLLECTIONS start block"), ecosystem: (eco as Ecosystem | undefined) ?? null };
    });
  const chog = process.env.CHOG_COLLECTION ? addr(process.env.CHOG_COLLECTION, "CHOG_COLLECTION") : null;
  if (chog && !collections.some((c) => c.address === chog)) collections.unshift({ address: chog, startBlock: 0n, ecosystem: "chog" });
  const chogSeed = collections.find((c) => c.address === chog);
  if (chogSeed) chogSeed.ecosystem = "chog";

  const rpcUrls = req("RPC_URLS").split(",").map((s) => s.trim()).filter(Boolean).map((s) => endpoint(s, "RPC_URLS", ["http:", "https:"]));
  if (!rpcUrls.length) throw new Error("RPC_URLS must contain at least one HTTP endpoint");
  return {
    rpcUrls,
    wsUrl: process.env.WS_URL ? endpoint(process.env.WS_URL, "WS_URL", ["ws:", "wss:"]) : null,
    chainId: num("CHAIN_ID", 10143),
    sweeper: addr(req("SWEEPER_ADDRESS"), "SWEEPER_ADDRESS"),
    sweeperDeployBlock: block(process.env.SWEEPER_DEPLOY_BLOCK, "SWEEPER_DEPLOY_BLOCK"),
    confirmations: BigInt(num("CONFIRMATIONS", 2, 0)),
    maxRange: BigInt(num("MAX_BLOCK_RANGE", 100)),
    pollMs: num("POLL_MS", 500),
    rewindDepth: BigInt(num("REWIND_DEPTH", 32)),
    databaseUrl: req("DATABASE_URL"),
    redis:
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
        ? { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN }
        : null,
    collections,
    chog,
    // Comma separated gateways tried in order with hedging; defaults to ipfs.io, dweb.link, w3s.link.
    resolver: withGateways(process.env.IPFS_GATEWAYS ?? process.env.IPFS_GATEWAY),
    metadataConcurrency: num("METADATA_CONCURRENCY", 8),
    healthPort: num("HEALTH_PORT", 8080, 1, 65535),
  };
}
export type Config = ReturnType<typeof loadConfig>;
