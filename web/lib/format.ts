import { formatEther, parseEther, type Address } from "viem";

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Parses a decimal MON string to wei; returns null when invalid or negative. */
export function parseMon(value: string): bigint | null {
  const v = value.trim();
  if (v === "") return 0n;
  if (!/^\d*\.?\d{0,18}$/.test(v) || v === ".") return null;
  try {
    return parseEther(v);
  } catch {
    return null;
  }
}

export function formatMon(wei: bigint, maxDecimals = 4): string {
  const s = formatEther(wei);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, maxDecimals).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : i;
}

export const sameAddress = (a?: Address | string | null, b?: Address | string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export const nftKey = (n: { contract: Address; tokenId: bigint }) => `${n.contract.toLowerCase()}:${n.tokenId}`;
