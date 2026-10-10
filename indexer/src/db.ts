import pg from "pg";

export interface Queryable {
  query<R = any>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}
export interface Db extends Queryable {
  /** Runs `fn` in a transaction; rolls back if it throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

// NUMERIC and BIGINT stay strings: uint256 does not fit in a JS number.
pg.types.setTypeParser(20, (v) => v);
pg.types.setTypeParser(1700, (v) => v);

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle client erroring (e.g. DB restart) must not crash the process.
  pool.on("error", (e) => console.error(JSON.stringify({ level: "warn", msg: "pg pool error", err: String(e) })));

  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as Promise<{ rows: any[] }>,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}
