// Records the real Chog ERC-721 in config/verified-collections.json (ecosystem "chog"); `make connect-chog` calls it after
// the on-chain setChogCollection / setVerifiedCollections transactions. Then `make export` rewrites the web/indexer env.
//
//   node ops/connect-chog.mjs --chain-id 10143 --address 0x... --start-block 12345 [--name "Chog"]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const chainId = String(arg("chain-id", "10143"));
const address = getAddress(arg("address", ""));
const startBlock = Number(arg("start-block", ""));
if (!Number.isInteger(startBlock) || startBlock < 0) throw new Error("--start-block must be the collection's deploy block (a whole number)");
const name = arg("name", "Chog") || "Chog";

const file = resolve(ROOT, "config/verified-collections.json");
const cfg = JSON.parse(readFileSync(file, "utf8"));
const list = (cfg.chains[chainId] ??= []);
// There is one Chog collection: any earlier entry flagged "chog" (the mock) becomes an ordinary verified Monad collection.
for (const c of list) if (c.ecosystem === "chog" && getAddress(c.address) !== address) c.ecosystem = "monad";
const i = list.findIndex((c) => getAddress(c.address) === address);
const entry = { address, ecosystem: "chog", startBlock, name };
if (i === -1) list.unshift(entry); else list[i] = { ...list[i], ...entry };
writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log(`Chog collection for chain ${chainId}: ${name} ${address} (from block ${startBlock})`);
console.log("Now: update Vercel/Railway env from web/.env.local and indexer/.env, then redeploy.");
