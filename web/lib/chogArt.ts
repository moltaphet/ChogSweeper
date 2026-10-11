/**
 * The official Chog artwork shipped with the site (`public/chogs/<rarity>/<rarity>-NN.webp`, transparent corners, 560px).
 * `chogArtFor(id)` maps any token id to one of them, the same id always to the same picture.
 */
export type Rarity = "legendary" | "epic" | "rare" | "uncommon" | "common";

const COUNTS: Record<Rarity, number> = { legendary: 8, epic: 10, rare: 5, uncommon: 5, common: 5 };
/** Rarest first, so a catalog index below 8 is always a legendary. */
const ORDER: readonly Rarity[] = ["legendary", "epic", "rare", "uncommon", "common"];

export interface ChogArt {
  src: string;
  rarity: Rarity;
}

export const CHOG_ART: readonly ChogArt[] = ORDER.flatMap((rarity) =>
  Array.from({ length: COUNTS[rarity] }, (_, i) => ({ rarity, src: `/chogs/${rarity}/${rarity}-${String(i + 1).padStart(2, "0")}.webp` })),
);

export const RARITY_LABEL: Record<Rarity, string> = { legendary: "Legendary", epic: "Epic", rare: "Rare", uncommon: "Uncommon", common: "Common" };

/** Chip colours per rarity: [background, text]. */
export const RARITY_STYLE: Record<Rarity, string> = {
  legendary: "bg-amber-100 text-amber-800",
  epic: "bg-fuchsia-100 text-fuchsia-800",
  rare: "bg-sky-100 text-sky-800",
  uncommon: "bg-emerald-100 text-emerald-800",
  common: "bg-slate-100 text-slate-700",
};

/** Picture for a token id (ids 1, 2, 3… walk through the whole set). */
export function chogArtFor(id: number | bigint): ChogArt {
  const n = Number(BigInt(id) % BigInt(CHOG_ART.length));
  return CHOG_ART[n]!;
}

/** The URL of that picture, or `null` for a non-Chog. */
export function chogImageFor(id: number | bigint): string {
  return chogArtFor(id).src;
}
