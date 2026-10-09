import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";
import { monadTestnet } from "../config";

export class UnsupportedChainError extends Error {
  constructor(public readonly chainId: number) {
    super(`Unsupported chainId ${chainId}`);
  }
}

const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_MAINNET_RPC_URL ?? "https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://monadvision.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

const CHAINS = new Map<number, Chain>([
  [monadTestnet.id, monadTestnet],
  [monadMainnet.id, monadMainnet],
]);

/** The chain the indexer database describes. DB-backed shortcuts apply only to this chain. */
export const INDEXER_CHAIN_ID = Number(process.env.INDEXER_CHAIN_ID ?? monadTestnet.id);

export const supportedChainIds = () => [...CHAINS.keys()];

const g = globalThis as unknown as { __clients?: Map<number, PublicClient> };

/** One reusable viem client per chain per serverless instance. */
export function getClient(chainId: number): PublicClient {
  const chain = CHAINS.get(chainId);
  if (!chain) throw new UnsupportedChainError(chainId);
  g.__clients ??= new Map();
  let c = g.__clients.get(chainId);
  if (!c) {
    // No automatic read batching (`batch.multicall`): with it, every readContract is silently routed through the chain's
    // Multicall3, so a chain/node where it is missing breaks ALL reads. Batching is done explicitly via `safeMulticall`,
    // which falls back to plain reads.
    c = createPublicClient({ chain, transport: http(undefined, { retryCount: 2, retryDelay: 200, timeout: 8_000 }) }) as PublicClient;
    g.__clients.set(chainId, c);
  }
  return c;
}
