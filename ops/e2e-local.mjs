// Runs the ENTIRE system locally and then the smoke test against it:
//   anvil (chain id 10143)  ->  forge script deploy  ->  exporter  ->  Postgres  ->  indexer  ->  Next.js API  ->  smoke.mjs
// Everything is torn down afterwards, pass or fail. Logs go to .e2e/logs/.
//   node ops/e2e-local.mjs [--keep]      (--keep leaves the stack running after the test for manual poking)
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { exportDeployment } from "./export-deployment.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const E2E = resolve(ROOT, ".e2e");
const LOGS = resolve(E2E, "logs");
const KEEP = process.argv.includes("--keep");

const CHAIN_ID = 10143; // same id as Monad Testnet so the web app's chain config applies unchanged
const ANVIL_PORT = 8645, PG_PORT = 54330, API_PORT = 3115, HEALTH_PORT = 8099;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const DB_URL = `postgres://postgres:pw@127.0.0.1:${PG_PORT}/chog`;
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil account 0
const TREASURY = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"; // anvil account 9

const children = [];
let pg;
const say = (m) => console.log(`\x1b[36m▸ ${m}\x1b[0m`);

function start(name, cmd, args, opts = {}) {
  const out = openSync(resolve(LOGS, `${name}.log`), "w");
  const p = spawn(cmd, args, { stdio: ["ignore", out, out], ...opts });
  p.on("error", (e) => console.error(`${name} failed to start: ${e.message}`));
  children.push({ name, p });
  return p;
}

function run(name, cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ ${name} failed:\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
    throw new Error(`${name} failed`);
  }
  return r.stdout;
}

async function waitFor(label, fn, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await fn()) return; } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out waiting for ${label} (see ${LOGS})`);
}

let tearingDown = null;
function teardown() {
  // Idempotent: a second signal while shutting down just waits for the first.
  tearingDown ??= (async () => {
    for (const { p } of [...children].reverse()) {
      try {
        if (p.exitCode === null) {
          p.kill("SIGTERM");
          await Promise.race([new Promise((r) => p.once("exit", r)), new Promise((r) => setTimeout(r, 1500))]);
          if (p.exitCode === null) p.kill("SIGKILL");
        }
      } catch { /* keep going: later children must still be stopped */ }
    }
    if (pg) await pg.stop().catch(() => {});
  })();
  return tearingDown;
}
// Ctrl+C, `kill`, CI cancellation and container stop all take the same orderly path.
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
  process.on(sig, async () => { await teardown(); process.exit(code); });
}
// Last resort if we are going down any other way: never leave children running.
process.on("exit", () => { for (const { p } of children) if (p.exitCode === null) p.kill("SIGKILL"); });

async function main() {
  rmSync(E2E, { recursive: true, force: true });
  mkdirSync(LOGS, { recursive: true });

  say(`anvil on :${ANVIL_PORT} (chain id ${CHAIN_ID}, 1s blocks)`);
  start("anvil", "anvil", ["--chain-id", String(CHAIN_ID), "--port", String(ANVIL_PORT), "--block-time", "1", "--silent"]);
  await waitFor("anvil", async () => (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' })).ok);

  say("deploying MockChog + ChogSweeper with forge script (fee 0.05 MON, Chog-holder exemption on)");
  const broadcastDir = resolve(E2E, "broadcast");
  run("forge script", "forge", ["script", "script/DeployChogSweeper.s.sol", "--rpc-url", RPC, "--broadcast", "--silent"], {
    cwd: ROOT,
    env: { ...process.env, PRIVATE_KEY: DEPLOYER_KEY, PLATFORM_FEE_WEI: "50000000000000000", TREASURY_ADDRESS: TREASURY, DEPLOY_MOCK_CHOG: "true", FOUNDRY_BROADCAST: broadcastDir },
  });
  const { record, env } = await exportDeployment({ chainId: CHAIN_ID, rpcUrl: RPC, broadcastDir, deploymentsDir: resolve(E2E, "deployments"), writeEnv: false });

  say(`Postgres on :${PG_PORT}`);
  pg = new EmbeddedPostgres({ databaseDir: resolve(E2E, "pgdata"), user: "postgres", password: "pw", port: PG_PORT, persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("chog");

  say("building and starting the indexer");
  run("indexer build", "npm", ["run", "build", "--silent"], { cwd: resolve(ROOT, "indexer") });
  start("indexer", "node", ["dist/main.js"], {
    cwd: resolve(ROOT, "indexer"),
    env: {
      ...process.env, ...env.indexer, RPC_URLS: RPC, DATABASE_URL: DB_URL, CONFIRMATIONS: "1", POLL_MS: "300", MAX_BLOCK_RANGE: "500",
      HEALTH_PORT: String(HEALTH_PORT), MIGRATIONS_DIR: resolve(ROOT, "db/migrations"), UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "",
    },
  });
  await waitFor("indexer health", async () => (await fetch(`http://127.0.0.1:${HEALTH_PORT}/healthz`)).ok, 90_000);

  say(`starting the Next.js API on :${API_PORT}`);
  start("web", "npx", ["next", "dev", "-p", String(API_PORT)], {
    cwd: resolve(ROOT, "web"),
    env: {
      ...process.env, ...env.web, NEXT_PUBLIC_RPC_URL: RPC, DATABASE_URL: DB_URL, NEXT_TELEMETRY_DISABLED: "1",
      UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "",
    },
  });
  await waitFor("web API", async () => (await fetch(`${API}/api/wallet/inventory?address=0x000000000000000000000000000000000000dEaD`)).ok, 120_000);

  say("running the smoke test\n");
  const smoke = spawnSync("node", ["smoke.mjs", "--local", "--rpc", RPC, "--api", API, "--chain-id", String(CHAIN_ID), "--deployments", resolve(E2E, "deployments"), ...(KEEP ? ["--seed-open"] : [])], {
    cwd: resolve(ROOT, "ops"), stdio: "inherit",
  });
  return smoke.status ?? 1;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error(`\n\x1b[31m${e.message}\x1b[0m`);
} finally {
  if (KEEP && code === 0) {
    console.log(`\nStack left running (--keep): API ${API}, RPC ${RPC}, logs in ${LOGS}. Ctrl+C to stop.`);
    console.log(`Demo wallets: A 0x70997970C51812dc3A010C7d01b50e0d17dc79C8   B 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`);
    await new Promise(() => {});
  }
  await teardown();
}
process.exit(code);
