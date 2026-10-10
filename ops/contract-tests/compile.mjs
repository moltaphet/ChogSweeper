// Compiles ChogSweeper + MockChog (and a few test helpers) with solc-js, so the contract can be tested without Foundry.
import solc from "solc";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
process.chdir(HERE);
const sources = {};
const add = (name, file) => (sources[name] = { content: fs.readFileSync(file, "utf8") });
add("src/ChogSweeper.sol", `${ROOT}/src/ChogSweeper.sol`);
add("src/MockChog.sol", `${ROOT}/src/MockChog.sol`);
add("helpers/JsMocks.sol", path.join(HERE, "helpers/JsMocks.sol"));
const input = { language: "Solidity", sources, settings: { optimizer: { enabled: true, runs: 1000 }, evmVersion: "shanghai", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
const findImports = (p) => {
  const m = p.replace(/^@openzeppelin\/contracts\//, "");
  const f = p.startsWith("@openzeppelin/contracts/") ? path.join("node_modules/@openzeppelin/contracts", m) : p;
  try { return { contents: fs.readFileSync(f, "utf8") }; } catch { return { error: "not found " + p }; }
};
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
for (const e of out.errors ?? []) if (e.severity === "error") { console.error(e.formattedMessage); process.exitCode = 1; }
else if (!/SPDX|Unused|unreachable/.test(e.message)) console.warn(e.formattedMessage.split("\n")[0]);
if (process.exitCode) process.exit(1);
const art = {};
for (const [file, cs] of Object.entries(out.contracts)) for (const [n, c] of Object.entries(cs)) art[n] = { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
fs.writeFileSync("artifacts.json", JSON.stringify(art));
console.log("compiled:", Object.keys(art).filter((n) => ["ChogSweeper", "MockChog", "MockNFT"].includes(n)).join(", "));
