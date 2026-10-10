import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { Db, Queryable } from "../src/db.js";
import { migrate } from "../src/migrate.js";

const adapt = (p: { query: PGlite["query"]; exec: PGlite["exec"] }): Queryable => ({
  async query(sql: string, params?: unknown[]) {
    if (!params) {
      const res = await p.exec(sql);
      return { rows: (res[res.length - 1]?.rows ?? []) as any[] };
    }
    return (await p.query(sql, params as any[])) as { rows: any[] };
  },
});

export async function testDb(): Promise<Db & { raw: PGlite }> {
  const raw = new PGlite();
  const db: Db & { raw: PGlite } = {
    raw,
    ...adapt(raw),
    tx: (fn) => raw.transaction((t) => fn(adapt(t as any))),
    end: () => raw.close(),
  };
  await migrate(db, path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../db/migrations"));
  return db;
}

export const A = {
  maker: "0x00000000000000000000000000000000000000a1",
  taker: "0x00000000000000000000000000000000000000b2",
  other: "0x00000000000000000000000000000000000000c3",
  chog: "0x000000000000000000000000000000000000c0c0",
  nft2: "0x000000000000000000000000000000000000d0d0",
};
