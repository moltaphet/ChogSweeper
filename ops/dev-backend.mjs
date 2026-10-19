// Persistent development database + read-only chain indexer. Never deploys or sends transactions.
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = resolve(root, ".local/postgres");
const readEnv = (file) => existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
const webFile = resolve(root, "web/.env.local");
const indexerFile = resolve(root, "indexer/.env");
const webEnv = readEnv(webFile);
const indexerEnv = readEnv(indexerFile);
const localUrl = "postgres://postgres:chogsweeper-local@127.0.0.1:54329/chogsweeper";
const databaseUrl = process.env.DATABASE_URL || indexerEnv.DATABASE_URL || webEnv.DATABASE_URL || localUrl;
let pg;
let child;
let stopping;

async function stop() {
  stopping ??= (async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
    }
    if (pg) await pg.stop();
  })();
  return stopping;
}
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, async () => { await stop(); process.exit(0); });

try {
  if (!indexerEnv.SWEEPER_ADDRESS || !indexerEnv.RPC_URLS) throw new Error("Set SWEEPER_ADDRESS and RPC_URLS in indexer/.env first");
  if (databaseUrl === localUrl) {
    mkdirSync(data, { recursive: true });
    pg = new EmbeddedPostgres({
      databaseDir: data, port: 54329, user: "postgres", password: "chogsweeper-local", persistent: true,
      postgresFlags: ["-h", "127.0.0.1", "-k", resolve(root, ".local")],
      onLog: (s) => { if (/FATAL|ERROR/.test(s)) console.error(s.trim()); },
      onError: (e) => console.error(e),
    });
    if (!existsSync(resolve(data, "PG_VERSION"))) await pg.initialise();
    await pg.start();
    const admin = pg.getPgClient("postgres", "127.0.0.1");
    await admin.connect();
    try {
      if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = 'chogsweeper'")).rows.length) await admin.query('CREATE DATABASE "chogsweeper"');
    } finally { await admin.end(); }
    console.log("Local PostgreSQL ready on 127.0.0.1:54329 (data saved in .local/postgres)");
  }
  // Fill only missing configuration. A configured database is never silently replaced.
  for (const [file, values] of [[webFile, webEnv], [indexerFile, indexerEnv]]) {
    if (!values.DATABASE_URL && !/^\s*DATABASE_URL\s*=/m.test(existsSync(file) ? readFileSync(file, "utf8") : "")) {
      appendFileSync(file, `\n# Local backend connection\nDATABASE_URL=${databaseUrl}\n`);
    }
  }
  const build = spawn("npm", ["run", "build"], { cwd: resolve(root, "indexer"), stdio: "inherit" });
  const built = await new Promise((r, reject) => { build.once("error", reject); build.once("exit", r); });
  if (built !== 0) throw new Error("Indexer build failed");
  child = spawn(process.execPath, ["dist/main.js"], {
    cwd: resolve(root, "indexer"), stdio: "inherit",
    env: { ...indexerEnv, ...process.env, DATABASE_URL: databaseUrl },
  });
  child.once("error", (e) => { console.error(e.message); void stop().then(() => process.exit(1)); });
  console.log("Indexer running; keep this terminal open. Start the site separately with cd web && npm run dev.");
  const code = await new Promise((r) => child.once("exit", r));
  await stop();
  process.exitCode = code ?? 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  await stop();
  process.exitCode = 1;
}
