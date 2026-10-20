import pg from "pg";
import type { Queryable } from "./queryable";

pg.types.setTypeParser(20, (v) => v);
pg.types.setTypeParser(1700, (v) => v);

const g = globalThis as unknown as { __pgPool?: pg.Pool };

/**
 * One small pool per serverless instance, reused across warm invocations.
 * Point DATABASE_URL at the Supabase *transaction pooler* (port 6543) so many instances share few connections.
 */
export function getDb(): Queryable {
  if (!g.__pgPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const ca = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n").trim();
    let connectionString = url;
    if (ca) {
      // node-postgres parses connectionString after the explicit options, so
      // sslmode=require would otherwise overwrite the verified CA settings.
      const parsed = new URL(url);
      for (const key of ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey"]) {
        parsed.searchParams.delete(key);
      }
      connectionString = parsed.toString();
    }
    g.__pgPool = new pg.Pool({
      connectionString,
      ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: 8_000,
      statement_timeout: 8_000,
    });
    // pg emits idle connection failures outside requests; an unhandled error would terminate the web process.
    g.__pgPool.on("error", () => { markDbFailure(); console.warn("database connection lost"); });
  }
  return g.__pgPool as unknown as Queryable;
}

let failedAt = 0;

/**
 * The database when it is configured and reachable, otherwise null. After a failure it stays "down" for 10s so a
 * dead database costs one timeout per window, not one per request. Callers must treat null as "no indexer".
 */
export function getDbOrNull(): Queryable | null {
  if (!process.env.DATABASE_URL) return null;
  if (Date.now() - failedAt < 10_000) return null;
  return getDb();
}

export function markDbFailure() {
  failedAt = Date.now();
}
