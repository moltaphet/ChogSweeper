/**
 * "Unread" incoming requests: an incoming offer counts as unread until the user has opened the Requests view while it was
 * listed. The record is per wallet, kept in this browser only (nothing is sent anywhere).
 */
const CAP = 500;
export const seenKey = (address: string) => `chogsweeper:seen-incoming:${address.toLowerCase()}`;

export function loadSeen(address: string, storage: Pick<Storage, "getItem"> = localStorage): Set<string> {
  try {
    const raw = JSON.parse(storage.getItem(seenKey(address)) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set(); // storage unavailable or corrupted: everything simply shows as unread
  }
}

/** Adds `ids` to the seen set, keeping only the newest CAP entries (swap ids grow, so the highest are the newest). */
export function mergeSeen(seen: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const all = [...new Set([...seen, ...ids])];
  if (all.length <= CAP) return new Set(all);
  const newest = all.sort((a, b) => (BigInt(a) < BigInt(b) ? 1 : -1)).slice(0, CAP);
  return new Set(newest);
}

export function saveSeen(address: string, seen: ReadonlySet<string>, storage: Pick<Storage, "setItem"> = localStorage) {
  try {
    storage.setItem(seenKey(address), JSON.stringify([...seen]));
  } catch {
    /* ignore: the badge just reappears next visit */
  }
}

export const countUnread = (incomingIds: readonly string[], seen: ReadonlySet<string>) => incomingIds.filter((id) => !seen.has(id)).length;
