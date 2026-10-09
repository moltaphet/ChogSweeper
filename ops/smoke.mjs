// End-to-end trade smoke test for ChogSweeper.
//
//   Wallet A mints Chog; Wallet B mints Chog and holds >= 1 MON.
//   A offers its Chog for B's Chog + 0.5 MON.  B finds the offer under "Incoming", accepts, and we verify
//   atomic settlement and exact balance changes.
//
//   Local (anvil):   node smoke.mjs --local --rpc http://127.0.0.1:8545 [--api http://localhost:3000]
//   Testnet:         PRIVATE_KEY_A=0x… PRIVATE_KEY_B=0x… node smoke.mjs --rpc https://testnet-rpc.monad.xyz/ [--api https://…]
//
// With --api the script also checks what the UI reads: /api/swaps (Incoming / Outgoing / History) and /api/wallet/inventory.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, defineChain, formatEther, getAddress, http, parseEther, parseEventLogs, zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);

const LOCAL = has("local");
const RPC = arg("rpc", process.env.MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz/");
const API = arg("api", process.env.SMOKE_API_URL ?? "")?.replace(/\/$/, "");
const CHAIN_ID = Number(arg("chain-id", 10143));
const DEPLOYMENTS = resolve(arg("deployments", resolve(ROOT, "deployments")));
const SEND_MON = parseEther(arg("mon", "0.5")); // the MON A asks B for

// anvil's well-known accounts 1 and 2 (account 0 deploys)
const ANVIL_KEYS = ["0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"];
const keyA = process.env.PRIVATE_KEY_A ?? (LOCAL ? ANVIL_KEYS[0] : "");
const keyB = process.env.PRIVATE_KEY_B ?? (LOCAL ? ANVIL_KEYS[1] : "");
if (!keyA || !keyB) { console.error("Set PRIVATE_KEY_A and PRIVATE_KEY_B (two funded testnet wallets), or use --local."); process.exit(2); }

const deployment = JSON.parse(readFileSync(resolve(DEPLOYMENTS, `${CHAIN_ID}.json`), "utf8"));
const sweeperAbi = JSON.parse(readFileSync(resolve(ROOT, "web/lib/generated/ChogSweeper.abi.json"), "utf8"));
const chogAbi = JSON.parse(readFileSync(resolve(ROOT, "web/lib/generated/MockChog.abi.json"), "utf8"));
const SWEEPER = deployment.sweeper.address;
const CHOG = deployment.mockChog?.address;
if (!CHOG) { console.error("This deployment has no MockChog; the smoke test mints its own Chogs and needs one."); process.exit(2); }

const chain = defineChain({ id: CHAIN_ID, name: "target", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const A = privateKeyToAccount(keyA);
const B = privateKeyToAccount(keyB);
const wallet = (account) => createWalletClient({ account, chain, transport: http(RPC) });
const wA = wallet(A);
const wB = wallet(B);

// ------------------------------------------------------------------------------------------ reporting

const results = [];
let step = 0;
const ok = (name, detail = "") => { results.push({ ok: true, name }); console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`); };
const fail = (name, detail) => { results.push({ ok: false, name }); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${detail}`); throw new Error(`FAILED: ${name}`); };
const check = (cond, name, detail = "") => (cond ? ok(name, detail) : fail(name, detail || "condition was false"));
const eq = (actual, expected, name) => check(actual === expected, name, actual === expected ? String(actual) : `expected ${expected}, got ${actual}`);
const heading = (t) => console.log(`\n\x1b[1m${++step}. ${t}\x1b[0m`);
const mon = (wei) => `${formatEther(wei)} MON`;

// Gas ledger per wallet. Monad bills gas LIMIT x price, so a balance can legitimately sit anywhere between
// "gas used" (lower) and "gas limit" (upper). A local chain bills gas used, so there the bound is exact.
const gas = { [A.address]: { lo: 0n, hi: 0n }, [B.address]: { lo: 0n, hi: 0n } };
async function send(account, label, request) {
  const client = account.address === A.address ? wA : wB;
  const hash = await client.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") fail(`${label} succeeded on-chain`, `tx ${hash} reverted`);
  const tx = await pub.getTransaction({ hash });
  gas[account.address].lo += receipt.gasUsed * receipt.effectiveGasPrice;
  gas[account.address].hi += tx.gas * receipt.effectiveGasPrice;
  return receipt;
}

async function eventually(fn, label, timeoutMs = 60_000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 750));
  }
  fail(label, `timed out after ${timeoutMs / 1000}s${last ? `: ${last.message}` : ""}`);
}
const api = async (path) => { const r = await fetch(`${API}${path}`); if (!r.ok) throw new Error(`${path} -> ${r.status}`); return r.json(); };

// ------------------------------------------------------------------------------------------ the flow

async function main() {
  console.log(`\nChogSweeper smoke test\n  chain ${CHAIN_ID}   rpc ${RPC}\n  sweeper ${SWEEPER}\n  chog    ${CHOG}\n  A ${A.address}\n  B ${B.address}\n  api     ${API || "(not provided: UI-layer checks skipped)"}`);

  const rpcChain = await pub.getChainId();
  eq(rpcChain, CHAIN_ID, "RPC reports the expected chain id");

  heading("Wallet A mints a Chog; Wallet B mints a Chog and holds >= 1 MON");
  const mintReceiptA = await send(A, "A mints Chog", { address: CHOG, abi: chogAbi, functionName: "mint", args: [A.address] });
  const mintReceiptB = await send(B, "B mints Chog", { address: CHOG, abi: chogAbi, functionName: "mint", args: [B.address] });
  const idOf = (r) => parseEventLogs({ abi: chogAbi, logs: r.logs, eventName: "Transfer" })[0].args.tokenId;
  const chogA = idOf(mintReceiptA);
  const chogB = idOf(mintReceiptB);
  eq((await pub.readContract({ address: CHOG, abi: chogAbi, functionName: "ownerOf", args: [chogA] })).toLowerCase(), A.address.toLowerCase(), `A owns Chog #${chogA}`);
  eq((await pub.readContract({ address: CHOG, abi: chogAbi, functionName: "ownerOf", args: [chogB] })).toLowerCase(), B.address.toLowerCase(), `B owns Chog #${chogB}`);

  // B must be able to pay 0.5 MON + gas. Top up from A if short (on a funded testnet this is a real transfer).
  const need = parseEther("1");
  let balB = await pub.getBalance({ address: B.address });
  if (balB < need) {
    const h = await wA.sendTransaction({ to: B.address, value: need - balB + parseEther("0.2") });
    const r = await pub.waitForTransactionReceipt({ hash: h });
    const t = await pub.getTransaction({ hash: h });
    gas[A.address].lo += r.gasUsed * r.effectiveGasPrice;
    gas[A.address].hi += t.gas * r.effectiveGasPrice;
    balB = await pub.getBalance({ address: B.address });
  }
  check(balB >= need, "B holds at least 1 MON", mon(balB));

  if (API) {
    heading("Both Chogs appear in each wallet's inventory, verified, with metadata (indexer + resolver)");
    const find = (inv, id) => inv.items.find((i) => i.contract.toLowerCase() === CHOG.toLowerCase() && i.tokenId === String(id));
    const invA = await eventually(async () => { const i = await api(`/api/wallet/inventory?address=${A.address}`); return find(i, chogA) ? i : null; }, "A's inventory lists its Chog");
    const nftA = find(invA, chogA);
    check(nftA.isChog && nftA.verified && nftA.ecosystem === "chog", "Chog is flagged verified (ecosystem: chog)");
    eq(nftA.name, `Mock Chog #${chogA}`, "name resolved from on-chain tokenURI");
    check(nftA.traits.length === 3 && nftA.meta === "ok", "3 traits resolved", nftA.traits.map((t) => `${t.trait_type}=${t.value}`).join(", "));
    check(!!nftA.image, "image resolved", nftA.image.slice(0, 48) + "…");
    await eventually(async () => find(await api(`/api/wallet/inventory?address=${B.address}`), chogB), "B's inventory lists its Chog");
    ok("B's inventory lists its Chog");
  }

  heading(`A approves the escrow and creates the swap: Chog #${chogA}  for  Chog #${chogB} + ${mon(SEND_MON)}`);
  await send(A, "A approves ChogSweeper", { address: CHOG, abi: chogAbi, functionName: "setApprovalForAll", args: [SWEEPER, true] });
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const created = await send(A, "A creates the swap", {
    address: SWEEPER, abi: sweeperAbi, functionName: "createSwap",
    args: [B.address, [{ nft: CHOG, tokenId: chogA }], [{ nft: CHOG, tokenId: chogB }], SEND_MON, expiry],
  });
  const tradeId = parseEventLogs({ abi: sweeperAbi, logs: created.logs, eventName: "TradeCreated" })[0].args.tradeId;
  ok(`TradeCreated emitted`, `trade #${tradeId}`);
  const [maker, taker, status] = await pub.readContract({ address: SWEEPER, abi: sweeperAbi, functionName: "getTrade", args: [tradeId] });
  eq(maker.toLowerCase(), A.address.toLowerCase(), "maker is A");
  eq(taker.toLowerCase(), B.address.toLowerCase(), "taker is B");
  eq(status, 1, "status is Active");
  eq((await pub.readContract({ address: CHOG, abi: chogAbi, functionName: "ownerOf", args: [chogA] })).toLowerCase(), SWEEPER.toLowerCase(), `Chog #${chogA} is in escrow`);

  if (API) {
    heading("B sees the offer under Incoming Requests (what the Requests tab reads)");
    const incoming = await eventually(async () => {
      const r = await api(`/api/swaps?user=${B.address}&type=incoming`);
      return r.swaps.find((s) => s.id === String(tradeId)) ?? null;
    }, "offer appears in B's Incoming list", 90_000);
    eq(incoming.status, "pending", "status shown as Pending");
    eq(incoming.maker.toLowerCase(), A.address.toLowerCase(), "from A");
    eq(incoming.offered[0]?.tokenId, String(chogA), "offered side: A's Chog");
    check(incoming.offered[0]?.verified === true && incoming.offered[0]?.name === `Mock Chog #${chogA}`, "offered Chog shows its name and verified badge");
    eq(incoming.wanted[0]?.tokenId, String(chogB), "wanted side: B's Chog");
    eq(incoming.wantedMon, SEND_MON.toString(), `asks for ${mon(SEND_MON)}`);
    const outgoing = await api(`/api/swaps?user=${A.address}&type=outgoing`);
    check(outgoing.swaps.some((s) => s.id === String(tradeId)), "the same offer is in A's Outgoing list");
  }

  heading("B accepts");
  const feeB = await pub.readContract({ address: SWEEPER, abi: sweeperAbi, functionName: "feeFor", args: [B.address] });
  const configuredFee = await pub.readContract({ address: SWEEPER, abi: sweeperAbi, functionName: "platformFee" });
  const chogCollection = await pub.readContract({ address: SWEEPER, abi: sweeperAbi, functionName: "chogCollection" });
  if (configuredFee > 0n && chogCollection.toLowerCase() === CHOG.toLowerCase()) {
    eq(feeB, 0n, "B pays no platform fee: it holds a Chog (fee is configured, exemption applies)");
  } else {
    ok(`platform fee for B: ${mon(feeB)}`);
  }
  const due = await pub.readContract({ address: SWEEPER, abi: sweeperAbi, functionName: "quoteAcceptance", args: [tradeId, B.address] });
  eq(due, SEND_MON + feeB, "quoteAcceptance = requested MON + fee");

  const balA0 = await pub.getBalance({ address: A.address });
  const balB0 = await pub.getBalance({ address: B.address });
  const sweeperBal0 = await pub.getBalance({ address: SWEEPER });
  const gasBase = { a: { ...gas[A.address] }, b: { ...gas[B.address] } };
  const treasuryBal0 = await pub.getBalance({ address: deployment.config.treasury });

  await send(B, "B approves ChogSweeper", { address: CHOG, abi: chogAbi, functionName: "setApprovalForAll", args: [SWEEPER, true] });
  await send(B, "B accepts the swap", { address: SWEEPER, abi: sweeperAbi, functionName: "acceptSwap", args: [tradeId], value: due });
  ok("acceptSwap confirmed");

  heading("Atomic settlement: tokens, balances, escrow");
  const owner = async (id) => (await pub.readContract({ address: CHOG, abi: chogAbi, functionName: "ownerOf", args: [id] })).toLowerCase();
  eq(await owner(chogA), B.address.toLowerCase(), `Chog #${chogA} (A's) is now B's`);
  eq(await owner(chogB), A.address.toLowerCase(), `Chog #${chogB} (B's) is now A's`);
  const [, , finalStatus] = await pub.readContract({ address: SWEEPER, abi: sweeperAbi, functionName: "getTrade", args: [tradeId] });
  eq(finalStatus, 2, "trade status is Accepted");

  const balA1 = await pub.getBalance({ address: A.address });
  const balB1 = await pub.getBalance({ address: B.address });
  // A sent no transactions since the baseline, so its change is exactly the MON it asked for.
  eq(balA1 - balA0, SEND_MON, `A received exactly ${mon(SEND_MON)}`);
  const spentLo = gas[B.address].lo - gasBase.b.lo;
  const spentHi = gas[B.address].hi - gasBase.b.hi;
  const bDelta = balB0 - balB1; // what B lost
  if (LOCAL) {
    eq(bDelta, due + spentLo, `B paid exactly ${mon(due)} + gas (${mon(spentLo)})`);
  } else {
    check(bDelta >= due + spentLo && bDelta <= due + spentHi, `B paid ${mon(due)} + gas within [used ${mon(spentLo)}, limit ${mon(spentHi)}]`, `lost ${mon(bDelta)}`);
  }
  const sweeperBal1 = await pub.getBalance({ address: SWEEPER });
  eq(sweeperBal1 - sweeperBal0, feeB, "escrow holds only the platform fee (no MON stuck)");
  eq((await pub.getBalance({ address: deployment.config.treasury })) - treasuryBal0, 0n, "treasury untouched until fees are withdrawn");

  heading("Replay and tamper checks");
  let reverted = false;
  try { await pub.simulateContract({ account: B, address: SWEEPER, abi: sweeperAbi, functionName: "acceptSwap", args: [tradeId], value: due }); } catch { reverted = true; }
  check(reverted, "accepting the same trade again reverts");
  reverted = false;
  try { await pub.simulateContract({ account: A, address: SWEEPER, abi: sweeperAbi, functionName: "cancelSwap", args: [tradeId] }); } catch { reverted = true; }
  check(reverted, "the maker cannot cancel a settled trade");

  if (API) {
    heading("The UI layer reflects the settlement");
    await eventually(async () => !(await api(`/api/swaps?user=${B.address}&type=incoming`)).swaps.some((s) => s.id === String(tradeId)), "offer leaves B's Incoming list");
    ok("offer left B's Incoming list");
    for (const [who, label] of [[A, "A"], [B, "B"]]) {
      const h = await eventually(async () => (await api(`/api/swaps?user=${who.address}&type=history`)).swaps.find((s) => s.id === String(tradeId)) ?? null, `${label}'s History lists the trade`);
      eq(h.status, "completed", `${label}'s History shows it as Completed`);
    }
    const inv = async (w, id) => (await api(`/api/wallet/inventory?address=${w.address}`)).items.some((i) => i.contract.toLowerCase() === CHOG.toLowerCase() && i.tokenId === String(id));
    await eventually(async () => (await inv(B, chogA)) && !(await inv(B, chogB)), "B's inventory now shows A's old Chog");
    await eventually(async () => (await inv(A, chogB)) && !(await inv(A, chogA)), "A's inventory now shows B's old Chog");
    ok("inventories swapped in the API");
    const resolved = await api(`/api/nft/resolve?contract=${CHOG}&tokenId=${chogA}`);
    eq(resolved.owner.toLowerCase(), B.address.toLowerCase(), "/api/nft/resolve reports the new owner");
  }
}

/** Leaves demo data behind: one public offer and one direct offer, both still open. Used by `e2e-local --keep`. */
async function seedOpenOffers() {
  console.log("\n\x1b[1mSeeding demo offers\x1b[0m");
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 6 * 3600);
  const mintOne = async (account) => idOf(await send(account, "mint demo Chog", { address: CHOG, abi: chogAbi, functionName: "mint", args: [account.address] }));
  const idOf = (r) => parseEventLogs({ abi: chogAbi, logs: r.logs, eventName: "Transfer" })[0].args.tokenId;
  const pubChog = await mintOne(A);
  await send(A, "post public offer", { address: SWEEPER, abi: sweeperAbi, functionName: "createSwap", args: [zeroAddress, [{ nft: CHOG, tokenId: pubChog }], [], parseEther("0.25"), expiry] });
  ok(`public offer: Chog #${pubChog} for 0.25 MON (anyone can accept)`);
  const directChog = await mintOne(A);
  await send(A, "post direct offer", { address: SWEEPER, abi: sweeperAbi, functionName: "createSwap", args: [B.address, [{ nft: CHOG, tokenId: directChog }], [], parseEther("0.1"), expiry] });
  ok(`direct offer to B: Chog #${directChog} for 0.1 MON`);
}

main()
  .then(async () => {
    if (has("seed-open")) await seedOpenOffers();
    const n = results.length;
    console.log(`\n\x1b[32m\x1b[1mSMOKE TEST PASSED\x1b[0m  (${n} checks)\n`);
  })
  .catch((e) => {
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n\x1b[31m\x1b[1mSMOKE TEST FAILED\x1b[0m  (${passed} passed before the failure)\n${e.message.startsWith("FAILED") ? "" : e.stack + "\n"}`);
    process.exit(1);
  });
