import type { RegistryEntry } from "./registry";

export interface PublicCollection {
  address: string;
  name: string | null;
  ecosystem: "chog" | "monad" | null;
  isChog: boolean;
}

/** The verified collections to showcase: Chog first, then alphabetical. Unverified (merely tracked) collections are never listed. */
export function verifiedCollections(registry: ReadonlyMap<string, RegistryEntry>, chainNames: ReadonlyMap<string, string | null> = new Map()): PublicCollection[] {
  return [...registry.values()]
    .filter((e) => e.verified)
    .map((e) => ({ address: e.address, name: e.name ?? chainNames.get(e.address) ?? null, ecosystem: e.ecosystem, isChog: e.isChog }))
    .sort((a, b) => Number(b.isChog) - Number(a.isChog) || (a.name ?? "￿").localeCompare(b.name ?? "￿") || a.address.localeCompare(b.address));
}
