import { isAddress, zeroAddress, type Address } from "viem";
import { CHOG_ART } from "./chogArt";
import { CHOG_COLLECTION } from "./config";
import { DEPLOYED_TEST_COLLECTIONS } from "./generated/testCollections";

export const DEFAULT_TEST_MINT_COUNT = 5;
const deployed = (v: string | undefined): Address | null => v && isAddress(v, { strict: false }) && v.toLowerCase() !== zeroAddress ? v as Address : null;

/** Test-only Chog replica, populated from the MockChog deployment record. */
export const TEST_CHOG_ADDRESS = deployed(process.env.NEXT_PUBLIC_TEST_CHOG_ADDRESS)
  ?? deployed(DEPLOYED_TEST_COLLECTIONS.chog)
  ?? CHOG_COLLECTION;

/** These are test replicas using supplied artwork, never the original collections' contracts. */
export const TEST_COLLECTIONS = [
  { slug: "r3tards", name: "r3tards", address: deployed(process.env.NEXT_PUBLIC_TEST_R3TARDS_ADDRESS) ?? deployed(DEPLOYED_TEST_COLLECTIONS.r3tards) },
  { slug: "skrumpeys", name: "skrumpeys", address: deployed(process.env.NEXT_PUBLIC_TEST_SKRUMPEYS_ADDRESS) ?? deployed(DEPLOYED_TEST_COLLECTIONS.skrumpeys) },
  { slug: "the-bobs", name: "The Bobs", address: deployed(process.env.NEXT_PUBLIC_TEST_BOBS_ADDRESS) ?? deployed(DEPLOYED_TEST_COLLECTIONS.theBobs) },
] as const;

/** The four sample-art groups available in the test mint screen. */
export const TEST_MINT_COLLECTIONS = [
  { slug: "chog", name: "Mock Chog", address: TEST_CHOG_ADDRESS, preview: CHOG_ART[0]!.src },
  ...TEST_COLLECTIONS.map((c) => ({ ...c, preview: testArtwork(c.slug, 1) })),
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
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "MAX_BATCH", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "mintBatch", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "count", type: "uint256" }], outputs: [{ name: "firstId", type: "uint256" }] },
] as const;
