// Runs the browser tests against a throw-away local chain:
//   ganache (chain id 10143) + ChogSweeper + MockChog + a Multicall3 stub  ->  next dev  ->  Playwright with a fake injected wallet
// Usage: npm test            (the trade flows: create, accept, decline, cancel, fee refund, verified-only, expiry/reclaim)
//        npm test -- --all   (also walks every page and tab, on desktop and phone widths: slow)
// Needs: `npm install` here, `npx playwright install chromium` (or CHROME_PATH=/path/to/chrome), and the contract artifacts,
// which this script builds with ../contract-tests/compile.mjs when missing.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PORT = process.env.PORT ?? "3102";
const all = process.argv.includes("--all");
const keep = process.argv.includes("--keep"); // leave the chain and the web app running afterwards, for poking at by hand
const children = [];
const stop = () => children.forEach((c) => { try { process.kill(-c.pid); } catch { try { c.kill(); } catch { /* already gone */ } } });
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

const artifacts = path.join(HERE, "../contract-tests/artifacts.json");
if (!fs.existsSync(artifacts)) {
  console.log("building contract artifacts…");
  const r = spawnSync("node", ["compile.mjs"], { cwd: path.join(HERE, "../contract-tests"), stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const waitFor = async (what, fn, ms = 120_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error(`timed out waiting for ${what}`);
};

console.log("starting the local chain…");
// Output goes to files, not pipes: the tests below run with spawnSync, which blocks this process, and a pipe nobody reads
// fills up and freezes the child (the dev server logs a lot).
const logDir = process.env.LOG_DIR ?? HERE;
const logFile = (name) => fs.openSync(path.join(logDir, name), "w");
const chain = spawn("node", ["chain.mjs"], { cwd: HERE, detached: true, stdio: ["ignore", logFile("chain.log"), logFile("chain.log")] });
children.push(chain);
await waitFor("the chain", () => fs.readFileSync(path.join(logDir, "chain.log"), "utf8").includes("READY"));
const info = JSON.parse(fs.readFileSync(path.join(HERE, "chain.json"), "utf8"));

console.log("starting the web app…");
const web = spawn("npx", ["next", "dev", "-p", PORT], {
  cwd: path.join(ROOT, "web"),
  detached: true,
  stdio: ["ignore", logFile("web.log"), logFile("web.log")],
  env: {
    ...process.env,
    NEXT_PUBLIC_RPC_URL: "http://127.0.0.1:8545",
    NEXT_PUBLIC_CHOGSWEEPER_ADDRESS: info.sweeper,
    NEXT_PUBLIC_CHOG_COLLECTION: info.chog,
    NEXT_PUBLIC_DEPLOY_BLOCK: "0",
    VERIFIED_COLLECTIONS: `${info.chog}:chog:0`,
    DATABASE_URL: "", // no indexer: the app reads trades straight from the chain
  },
});
children.push(web);
await waitFor("the web app", async () => (await fetch(`http://localhost:${PORT}/launchpad`)).ok);
// compile the heavy routes once so the first browser test is not racing the dev server
await fetch(`http://localhost:${PORT}/`).catch(() => {});
await fetch(`http://localhost:${PORT}/api/wallet/inventory?address=${info.accounts[2]}`).catch(() => {});

let failed = false;
for (const file of ["flows-trade.mjs", ...(all ? ["flows-more.mjs", "flows-pages.mjs"] : ["flows-more.mjs"])]) {
  console.log(`\n━━ ${file} ━━`);
  const r = spawnSync("node", [file], { cwd: HERE, stdio: "inherit", env: { ...process.env, BASE: `http://localhost:${PORT}` } });
  if (r.status !== 0) failed = true;
}
console.log(failed ? "\nUI END-TO-END: FAILED" : "\nUI END-TO-END: PASSED");
if (keep) {
  console.log(`\nleft running: chain http://127.0.0.1:8545 (chain id 10143), web http://localhost:${PORT}. Ctrl+C to stop.`);
  process.removeAllListeners("exit");
  await new Promise(() => {});
}
stop();
process.exit(failed ? 1 : 0);
