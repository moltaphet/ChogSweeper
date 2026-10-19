import { isAddress, zeroAddress, type Address } from "viem";
import { CHOG_ART } from "./chogArt";

export const TEST_NFTS_PER_CLAIM = 3;
const deployed = (v: string | undefined): Address | null => v && isAddress(v, { strict: false }) && v.toLowerCase() !== zeroAddress ? v as Address : null;

/** These are test replicas using supplied artwork, never the original collections' contracts. */
export const TEST_COLLECTIONS = [
  { slug: "r3tards", name: "r3tards", address: deployed(process.env.NEXT_PUBLIC_TEST_R3TARDS_ADDRESS) },
  { slug: "skrumpeys", name: "skrumpeys", address: deployed(process.env.NEXT_PUBLIC_TEST_SKRUMPEYS_ADDRESS) },
  { slug: "the-bobs", name: "The Bobs", address: deployed(process.env.NEXT_PUBLIC_TEST_BOBS_ADDRESS) },
] as const;

export function testArtwork(slug: string, tokenId: number | bigint) {
  const id = BigInt(tokenId);
  const sample = Number((id > 0n ? id - 1n : 0n) % 10n) + 1;
  return `/collections/${slug}/${String(sample).padStart(2, "0")}.webp`;
}

/** One Chog and one of each new collection per row of the decorative catalog. */
export const SHOWCASE_ART = Array.from({ length: 8 }, (_, i) => [
  { src: CHOG_ART[i]!.src, collection: "Chog" },
  ...TEST_COLLECTIONS.map((c) => ({ src: testArtwork(c.slug, i + 1), collection: c.name })),
]).flat();

export const testNftAbi = [
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "firstId", type: "uint256" }] },
  { type: "function", name: "claimed", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }], outputs: [{ name: "", type: "bool" }] },
] as const;
