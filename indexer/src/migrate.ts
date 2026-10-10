import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Queryable } from "./db.js";
import { log } from "./log.js";

/** Applies db/migrations/*.sql in order, once each. Safe to run on every boot. */
export async function migrate(db: { query: Queryable["query"]; tx: <T>(fn: (q: Queryable) => Promise<T>) => Promise<T> }, dir: string) {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const done = await db.query("SELECT 1 FROM schema_migrations WHERE name = $1", [f]);
    if (done.rows.length) continue;
    const sql = await readFile(path.join(dir, f), "utf8");
    await db.tx(async (q) => {
      await q.query(sql);
      await q.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    });
    log.info("migration applied", { file: f });
  }
}
