import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Queryable } from "./db.js";
import { log } from "./log.js";

/** Applies db/migrations/*.sql in order, once each. Safe to run on every boot. */
export async function migrate(db: { query: Queryable["query"]; tx: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T> }, dir: string) {
  await db.tx(async (q) => {
    await q.query("SELECT pg_advisory_xact_lock($1)", [824013]);
    await q.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  });
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = await readFile(path.join(dir, f), "utf8");
    const applied = await db.tx(async (q) => {
      // Serialize migration runners, and check the ledger only after acquiring the lock.
      await q.query("SELECT pg_advisory_xact_lock($1)", [824013]);
      const done = await q.query("SELECT 1 FROM schema_migrations WHERE name = $1", [f]);
      if (done.rows.length) return false;
      await q.query(sql);
      await q.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
      return true;
    });
    if (applied) log.info("migration applied", { file: f });
  }
}
