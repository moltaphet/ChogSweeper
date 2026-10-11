// Local test chain for UI end-to-end tests: ganache on chain id 10143 with ChogSweeper + MockChog + a Multicall3 stub deployed.
import ganache from "ganache";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { createPublicClient, createWalletClient, http, parseEther, getAddress } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MNEMONIC = "test test test test test test test test test test test junk";
const art = JSON.parse(fs.readFileSync(path.join(HERE, "../contract-tests/artifacts.json"), "utf8"));
const server = ganache.server({ logging: { quiet: true }, chain: { chainId: 10143, hardfork: "shanghai" }, wallet: { mnemonic: MNEMONIC, totalAccounts: 6, defaultBalance: 10_000 }, miner: { blockGasLimit: 60_000_000 } });
await server.listen(8545);
const chain = { id: 10143, name: "local", nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } };
const pub = createPublicClient({ chain, transport: http() });
const accts = [0, 1, 2, 3, 4, 5].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
const w = (i) => createWalletClient({ account: accts[i], chain, transport: http() });
const wait = (h) => pub.waitForTransactionReceipt({ hash: h });
const deploy = async (name, args = []) => (await wait(await w(0).deployContract({ abi: art[name].abi, bytecode: art[name].bytecode, args, gas: 12_000_000n }))).contractAddress;
const call = async (i, address, name, functionName, args = [], value = 0n) => wait(await w(i).writeContract({ address, abi: art[name].abi, functionName, args, value, gas: 8_000_000n }));

// Multicall3 stub at the canonical address
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "M.sol": { content: fs.readFileSync(path.join(HERE, "Multicall3Lite.sol"), "utf8") } }, settings: { evmVersion: "shanghai", outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } } } })));
const runtime = "0x" + out.contracts["M.sol"].Multicall3Lite.evm.deployedBytecode.object;
await server.provider.request({ method: "evm_setAccountCode", params: ["0xcA11bde05977b3631167028862bE2a173976CA11", runtime] });

const FEE = parseEther("0.05");
const sweeper = await deploy("ChogSweeper", [accts[0].address, accts[1].address, FEE]);
const chog = await deploy("MockChog");
const other = await deploy("MockNFT", ["Other"]); // a collection that is NOT verified
await call(0, sweeper, "ChogSweeper", "setVerifiedCollections", [[chog], true]);
await call(0, sweeper, "ChogSweeper", "setChogCollection", [chog]);
const mint = (i, n) => call(0, chog, "MockChog", "mintBatch", [accts[i].address, BigInt(n)]);
// A (index 2) holds Chogs => fee-free. B (index 3) holds Chogs too. C (index 4) holds no Chog but one "other" NFT.
await mint(2, 4); await mint(3, 4);
await call(0, other, "MockNFT", "mint", [accts[4].address, 1n]);
await call(0, other, "MockNFT", "mint", [accts[3].address, 77n]);
const info = { sweeper, chog, other, fee: FEE.toString(), accounts: accts.map((a) => a.address), deployBlock: Number(await pub.getBlockNumber()) };
fs.writeFileSync(path.join(HERE, "chain.json"), JSON.stringify(info, null, 2));
console.log("READY", JSON.stringify(info));
setInterval(() => {}, 1 << 30);
