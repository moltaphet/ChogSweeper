// Turns a `forge script` broadcast into everything the rest of the system needs:
//   deployments/<chainId>.json            addresses, deploy blocks, on-chain config (source of truth)
//   web/lib/generated/*.abi.json          ABIs for the frontend
//   indexer/abi/*.abi.json                ABIs for the indexer
//   web/.env.local, indexer/.env          addresses, deploy block, verified-collection lists (merged, never clobbered)
//
//   node ops/export-deployment.mjs --chain-id 10143 --rpc https://testnet-rpc.monad.xyz/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, getAddress, http, parseAbi } from "viem";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "DeployChogSweeper.s.sol";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, JSON.stringify(v, null, 2) + "\n"));

/** Sets KEY=value lines in an env file, keeping every other line (comments, other keys) as it was. */
export function upsertEnv(file, values) {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  const seen = new Set();
  const out = lines.map((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (m && m[1] in values) {
      seen.add(m[1]);
      return `${m[1]}=${values[m[1]]}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k}=${v}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out.join("\n") + "\n");
}

function readBroadcast(broadcastDir, chainId) {
  const file = resolve(broadcastDir, SCRIPT, String(chainId), "run-latest.json");
  if (!existsSync(file)) throw new Error(`No broadcast found at ${file}. Run the deploy with --broadcast first.`);
  const run = readJson(file);
  const receipts = new Map((run.receipts ?? []).map((r) => [r.transactionHash, r]));
  const find = (name) => {
    const tx = (run.transactions ?? []).find((t) => t.contractName === name && t.transactionType === "CREATE");
    if (!tx) return null;
    const receipt = receipts.get(tx.hash);
    if (!receipt) throw new Error(`${name} was broadcast but has no receipt yet (${tx.hash}). Wait for confirmation and re-run the export.`);
    if (receipt.status !== "0x1" && receipt.status !== 1) throw new Error(`${name} deployment reverted (${tx.hash})`);
    return { address: getAddress(tx.contractAddress), block: Number(BigInt(receipt.blockNumber)), tx: tx.hash };
  };
  const sweeper = find("ChogSweeper");
  if (!sweeper) throw new Error("ChogSweeper not found in the broadcast");
  return { sweeper, mock: find("MockChog"), deployer: getAddress(run.transactions[0].transaction.from) };
}

export async function exportDeployment({
  chainId,
  rpcUrl,
  broadcastDir = resolve(ROOT, "broadcast"),
  deploymentsDir = resolve(ROOT, "deployments"),
  writeEnv = true,
  log = console.log,
}) {
  const { sweeper, mock, deployer } = readBroadcast(broadcastDir, chainId);

  // What the contract is actually configured with, read back from the chain rather than trusted from env.
  const client = createPublicClient({ chain: defineChain({ id: chainId, name: "target", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } }), transport: http(rpcUrl) });
  const abi = parseAbi([
    "function owner() view returns (address)", "function pendingOwner() view returns (address)", "function treasury() view returns (address)",
    "function platformFee() view returns (uint128)", "function chogCollection() view returns (address)", "function tradeCount() view returns (uint256)",
  ]);
  const read = (functionName) => client.readContract({ address: sweeper.address, abi, functionName });
  const [owner, pendingOwner, treasury, platformFee, chogCollection] = await Promise.all(["owner", "pendingOwner", "treasury", "platformFee", "chogCollection"].map(read));

  const seed = (existsSync(resolve(ROOT, "config/verified-collections.json")) ? readJson(resolve(ROOT, "config/verified-collections.json")).chains?.[String(chainId)] : null) ?? [];
  const collections = seed.map((c) => ({ address: getAddress(c.address), ecosystem: c.ecosystem, startBlock: Number(c.startBlock ?? 0), name: c.name ?? null, mock: false, testArtwork: c.testArtwork ?? null }));
  if (mock && !collections.some((c) => c.address === mock.address)) collections.unshift({ address: mock.address, ecosystem: "chog", startBlock: mock.block, name: "Mock Chog", mock: true });
  // An externally supplied Chog contract (CHOG_COLLECTION at deploy time) is verified as Chog too.
  if (chogCollection !== "0x0000000000000000000000000000000000000000" && !collections.some((c) => c.address === getAddress(chogCollection))) {
    collections.unshift({ address: getAddress(chogCollection), ecosystem: "chog", startBlock: 0, name: "Chog", mock: false });
  }
  const testCollections = {
    chog: mock?.address ?? "",
    r3tards: collections.find((c) => c.testArtwork === "r3tards")?.address ?? "",
    skrumpeys: collections.find((c) => c.testArtwork === "skrumpeys")?.address ?? "",
    theBobs: collections.find((c) => c.testArtwork === "the-bobs")?.address ?? "",
  };

  const record = {
    chainId,
    exportedAt: new Date().toISOString(),
    deployer,
    sweeper,
    mockChog: mock,
    config: { owner, pendingOwner, treasury, platformFeeWei: platformFee.toString(), chogCollection },
    verifiedCollections: collections,
  };
  writeJson(resolve(deploymentsDir, `${chainId}.json`), record);

  // ABIs straight from the compiled artifacts, so they can never drift from the deployed code.
  const artifact = (name) => readJson(resolve(ROOT, "out", `${name}.sol`, `${name}.json`)).abi;
  for (const name of ["ChogSweeper", ...(mock ? ["MockChog"] : [])]) {
    writeJson(resolve(ROOT, "web/lib/generated", `${name}.abi.json`), artifact(name));
    writeJson(resolve(ROOT, "indexer/abi", `${name}.abi.json`), artifact(name));
  }
  const testAddressesSource = `// Generated by ops/export-deployment.mjs; these are public testnet contract addresses.\nexport const DEPLOYED_TEST_COLLECTIONS = ${JSON.stringify(testCollections, null, 2)} as const;\n`;
  writeFileSync(resolve(ROOT, "web/lib/generated/testCollections.ts"), testAddressesSource);

  const chogAddr = collections.find((c) => c.ecosystem === "chog")?.address ?? "";
  const env = {
    web: {
      NEXT_PUBLIC_CHOGSWEEPER_ADDRESS: sweeper.address,
      NEXT_PUBLIC_DEPLOY_BLOCK: String(sweeper.block),
      NEXT_PUBLIC_CHOG_COLLECTION: chogAddr,
      NEXT_PUBLIC_COLLECTIONS: collections.map((c) => c.address).join(","),
      VERIFIED_COLLECTIONS: collections.map((c) => `${c.address}:${c.ecosystem}:${c.startBlock}`).join(","),
      INDEXER_CHAIN_ID: String(chainId),
      NEXT_PUBLIC_TEST_CHOG_ADDRESS: testCollections.chog,
      NEXT_PUBLIC_TEST_R3TARDS_ADDRESS: testCollections.r3tards,
      NEXT_PUBLIC_TEST_SKRUMPEYS_ADDRESS: testCollections.skrumpeys,
      NEXT_PUBLIC_TEST_BOBS_ADDRESS: testCollections.theBobs,
    },
    indexer: {
      CHAIN_ID: String(chainId),
      SWEEPER_ADDRESS: sweeper.address,
      SWEEPER_DEPLOY_BLOCK: String(sweeper.block),
      CHOG_COLLECTION: chogAddr,
      COLLECTIONS: collections.map((c) => `${c.address}:${c.startBlock}:${c.ecosystem}`).join(","),
    },
  };
  if (writeEnv) {
    upsertEnv(resolve(ROOT, "web/.env.local"), env.web);
    upsertEnv(resolve(ROOT, "indexer/.env"), { ...env.indexer, ...(existsSync(resolve(ROOT, "indexer/.env")) && /^RPC_URLS=/m.test(readFileSync(resolve(ROOT, "indexer/.env"), "utf8")) ? {} : { RPC_URLS: rpcUrl }) });
  }

  log(`ChogSweeper   ${sweeper.address}  (block ${sweeper.block})`);
  if (mock) log(`MockChog      ${mock.address}  (block ${mock.block})`);
  log(`fee           ${platformFee} wei   treasury ${treasury}   owner ${owner}${pendingOwner !== "0x0000000000000000000000000000000000000000" ? `   PENDING owner ${pendingOwner}` : ""}`);
  log(`wrote         deployments/${chainId}.json, ABIs, web/lib/generated/testCollections.ts${writeEnv ? ", web/.env.local, indexer/.env" : ""}`);
  return { record, env };
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : d; };
  const chainId = Number(arg("chain-id", 10143));
  const rpcUrl = arg("rpc", process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz/");
  exportDeployment({ chainId, rpcUrl, writeEnv: !process.argv.includes("--no-env") }).catch((e) => { console.error(`export failed: ${e.message}`); process.exit(1); });
}
