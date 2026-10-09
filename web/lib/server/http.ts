import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "./ratelimit";

export const badRequest = (message: string) => NextResponse.json({ error: message }, { status: 400 });

/** Returns a 429 response when `req` exceeded its budget, otherwise null. */
export async function limited(req: Request, bucket: string, limit: number, windowSec = 60) {
  const r = await rateLimit(`${bucket}:${clientIp(req.headers)}`, limit, windowSec);
  if (r.ok) return null;
  return NextResponse.json({ error: "rate limit exceeded" }, { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } });
}

export const parseChainId = (raw: string | null, fallback: number) => (raw === null || raw === "" ? fallback : Number(raw));
export const isTokenId = (v: string) => /^(0|[1-9]\d{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
