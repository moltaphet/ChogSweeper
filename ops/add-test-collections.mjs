// Reads the broadcast of script/DeployTestCollections.s.sol and adds the mock collections it deployed to
// config/verified-collections.json (the seed list the export turns into the web/indexer env), then you run `make export`.
//
//   node ops/add-test-collections.mjs --chain-id 10143
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const chainId = String(arg("chain-id", "10143"));

const script = arg("script", "DeployTestCollections.s.sol");
if (!["DeployTestCollections.s.sol", "DeployArtworkCollections.s.sol"].includes(script)) throw new Error("Unsupported deployment script");
const file = resolve(ROOT, "broadcast", script, chainId, "run-latest.json");
if (!existsSync(file)) throw new Error(`No broadcast at ${file}. Run 'make test-collections' (or forge script ... --broadcast) first.`);
const run = JSON.parse(readFileSync(file, "utf8"));
const receipts = new Map((run.receipts ?? []).map((r) => [r.transactionHash, r]));

const found = [];
for (const tx of run.transactions ?? []) {
  if (!["MockCollection", "TestArtworkCollection"].includes(tx.contractName) || tx.transactionType !== "CREATE") continue;
  const receipt = receipts.get(tx.hash);
  if (!receipt) throw new Error(`${tx.arguments?.[0] ?? "a collection"} has no receipt yet (${tx.hash}). Wait for confirmation and re-run.`);
  if (receipt.status !== "0x1" && receipt.status !== 1) throw new Error(`deployment reverted (${tx.hash})`);
  const name = String(tx.arguments?.[0] ?? "Mock collection");
  const testArtwork = tx.contractName === "TestArtworkCollection" ? ({ "Test r3tards": "r3tards", "Test skrumpeys": "skrumpeys", "Test The Bobs": "the-bobs" })[name] : undefined;
  if (tx.contractName === "TestArtworkCollection" && !testArtwork) throw new Error(`Unknown artwork collection: ${name}`);
  found.push({ address: getAddress(tx.contractAddress), ecosystem: "monad", startBlock: Number(BigInt(receipt.blockNumber)), name, ...(testArtwork ? { testArtwork } : {}) });
}
if (!found.length) throw new Error("No test collection deployments in that broadcast.");

const cfgPath = resolve(ROOT, "config/verified-collections.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const list = (cfg.chains[chainId] ??= []);
let added = 0;
for (const c of found) {
  const i = list.findIndex((x) => getAddress(x.address) === c.address);
  if (i === -1) { list.push(c); added++; } else list[i] = { ...list[i], ...c };
}
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
console.log(`Added ${added} (updated ${found.length - added}) collections for chain ${chainId}:`);
for (const c of found) console.log(`  ${c.name.padEnd(16)} ${c.address}  (block ${c.startBlock})`);
console.log("Now run: make export");
