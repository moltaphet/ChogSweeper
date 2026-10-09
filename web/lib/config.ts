import { defineChain, isAddress, type Address } from "viem";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? "https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadExplorer", url: "https://testnet.monadexplorer.com" } },
  // Canonical Multicall3 (present on Monad Testnet). Without this, viem refuses every batched read.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
export const MAX_ASSETS_PER_SIDE = 10;

const asAddress = (v: string | undefined): Address | null => (v && isAddress(v) ? v : null);

/** Deployed ChogSweeper escrow. */
export const SWEEPER_ADDRESS = asAddress(process.env.NEXT_PUBLIC_CHOGSWEEPER_ADDRESS);
/** Block the escrow was deployed at; log queries start here. */
export const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? "0");
/** Chog collection, listed before all others. */
export const CHOG_COLLECTION = asAddress(process.env.NEXT_PUBLIC_CHOG_COLLECTION);
/** Extra collections to scan, comma separated. */
export const DEFAULT_COLLECTIONS: Address[] = (process.env.NEXT_PUBLIC_COLLECTIONS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is Address => isAddress(s));

export const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://ipfs.io/ipfs/";
