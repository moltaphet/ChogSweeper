import { isAddress, type Address } from "viem";
import { withGateways } from "./nft-resolver.js";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}
const num = (name: string, d: number) => (process.env[name] ? Number(process.env[name]) : d);
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
      return { address: addr(a!, "COLLECTIONS"), startBlock: BigInt(start || 0), ecosystem: (eco as Ecosystem | undefined) ?? null };
    });
  const chog = process.env.CHOG_COLLECTION ? addr(process.env.CHOG_COLLECTION, "CHOG_COLLECTION") : null;
  if (chog && !collections.some((c) => c.address === chog)) collections.unshift({ address: chog, startBlock: 0n, ecosystem: "chog" });
  const chogSeed = collections.find((c) => c.address === chog);
  if (chogSeed) chogSeed.ecosystem = "chog";

  return {
    rpcUrls: req("RPC_URLS").split(",").map((s) => s.trim()).filter(Boolean),
    wsUrl: process.env.WS_URL || null,
    chainId: num("CHAIN_ID", 10143),
    sweeper: addr(req("SWEEPER_ADDRESS"), "SWEEPER_ADDRESS"),
    sweeperDeployBlock: BigInt(process.env.SWEEPER_DEPLOY_BLOCK ?? "0"),
    confirmations: BigInt(num("CONFIRMATIONS", 2)),
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
    healthPort: num("HEALTH_PORT", 8080),
  };
}
export type Config = ReturnType<typeof loadConfig>;
