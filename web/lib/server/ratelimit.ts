import { getRedis } from "./cache";

const memory = new Map<string, { count: number; resetAt: number }>();

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Fixed-window limiter. Uses Redis when configured so the limit holds across serverless instances,
 * otherwise a per-instance map (weaker, but still bounds abuse of the outbound-fetching endpoints).
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateResult> {
  const redis = getRedis();
  if (redis) {
    try {
      const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
      const count = await redis.incr(k);
      if (count === 1) await redis.expire(k, windowSec);
      return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec: windowSec };
    } catch {
      /* fall through to the in-memory limiter */
    }
  }
  const now = Date.now();
  const cur = memory.get(key);
  if (!cur || cur.resetAt <= now) {
    if (memory.size > 5_000) for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true, remaining: limit - 1, retryAfterSec: windowSec };
  }
  cur.count++;
  return { ok: cur.count <= limit, remaining: Math.max(0, limit - cur.count), retryAfterSec: Math.ceil((cur.resetAt - now) / 1000) };
}

/** Client IP as set by the platform proxy (first hop of x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
