// Behavioural tests of ChogSweeper on an in-process EVM (ganache), no Foundry needed: `npm test` in this folder.
// They cover the fee model (maker pays, refunded on cancel/decline, kept on accept), the verified-collection list and the
// partner discount tiers. The Foundry suite in /test remains the full suite (fuzz, invariants, gas, reentrancy).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { encodeFunctionData, decodeErrorResult, toHex, createPublicClient, createWalletClient, custom, parseEther, getAddress, BaseError } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const art = JSON.parse(fs.readFileSync("artifacts.json", "utf8"));
const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: "shanghai" }, wallet: { totalAccounts: 8, defaultBalance: 1000 } });
const transport = custom(provider);
const pub = createPublicClient({ transport });
const accts = Object.values((await provider.request({ method: "eth_accounts" }))).map(getAddress);
const keys = Object.values(provider.getInitialAccounts()).map((a) => a.secretKey);
const wallets = keys.map((k) => createWalletClient({ account: privateKeyToAccount(k), transport }));
const [owner, treasury, alice, bob, carol, dave] = wallets;
const addr = (w) => w.account.address;
const FEE = parseEther("0.1");
const Z = "0x0000000000000000000000000000000000000000";

async function deploy(name, w, args = []) {
  const hash = await w.deployContract({ abi: art[name].abi, bytecode: art[name].bytecode, args, gas: 12_000_000n });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success", `deploy ${name}`);
  return r.contractAddress;
}
const call = async (w, address, name, functionName, args = [], value = 0n) => {
  const hash = await w.writeContract({ address, abi: art[name].abi, functionName, args, value, gas: 8_000_000n });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success", `${functionName} failed`);
  return r;
};
const read = (address, name, functionName, args = []) => pub.readContract({ address, abi: art[name].abi, functionName, args });
async function reverts(promise, re) {
  try { await promise; } catch (e) { assert.match(String(e?.message ?? e), re); return; }
  assert.fail("expected revert " + re);
}
const bal = (a) => pub.getBalance({ address: a });
const warp = async (s) => { await provider.request({ method: "evm_increaseTime", params: [s] }); await provider.request({ method: "evm_mine", params: [] }); };
const now = async () => Number((await pub.getBlock()).timestamp);

let S, NFT, NFT2, CHOG, PARTNER;
const sw = (w, fn, args, value) => call(w, S, "ChogSweeper", fn, args, value);
const ethCall = async (from, to, abi, functionName, args, value = 0n) => {
  const data = encodeFunctionData({ abi, functionName, args });
  try { return await provider.request({ method: "eth_call", params: [{ from, to, data, value: toHex(value), gas: "0x7a1200" }] }); }
  catch (e) {
    const d = e?.data;
    let name = String(e?.message ?? e);
    if (typeof d === "string" && d.length >= 10) { try { name = decodeErrorResult({ abi: [...art.ChogSweeper.abi, ...art.MockNFT.abi], data: d }).errorName; } catch { name = "rawRevert " + d; } }
    throw new Error(name);
  }
};
const swr = (w, fn, args, value = 0n) => ethCall(addr(w), S, art.ChogSweeper.abi, fn, args, value);
const readRevert = (fn, args) => ethCall(addr(alice), S, art.ChogSweeper.abi, fn, args);
const create = (w, { taker = Z, offered = [], wanted = [], offeredMon = 0n, wantedMon = 0n, expiry, value, } = {}) =>
  (async () => {
    const exp = expiry ?? (await now()) + 3600;
    const v = value ?? (await read(S, "ChogSweeper", "quoteCreation", [addr(w), offeredMon]));
    return sw(w, "createSwap", [taker, offered, wanted, offeredMon, wantedMon, BigInt(exp)], v);
  })();
const mint = (nft, to, id) => call(owner, nft, "MockNFT", "mint", [to, BigInt(id)]);
const approve = (w, nft) => call(w, nft, "MockNFT", "setApprovalForAll", [S, true]);
const asset = (nft, id) => ({ nft, tokenId: BigInt(id) });
const ownerOf = (nft, id) => read(nft, "MockNFT", "ownerOf", [BigInt(id)]);
const trade = async (id) => { const [maker, taker, status, expiry, offeredMon, wantedMon, fee, offered, wanted] = await read(S, "ChogSweeper", "getTrade", [BigInt(id)]); return { maker, taker, status, expiry, offeredMon, wantedMon, fee, offered, wanted }; };

let id = 1000;
before(async () => {
  S = await deploy("ChogSweeper", owner, [addr(owner), addr(treasury), FEE]);
  NFT = await deploy("MockNFT", owner, ["A"]);
  NFT2 = await deploy("MockNFT", owner, ["B"]);
  CHOG = await deploy("MockNFT", owner, ["Chog"]);
  PARTNER = await deploy("MockNFT", owner, ["Partner"]);
  await sw(owner, "setVerifiedCollections", [[NFT, NFT2, CHOG, PARTNER], true]);
  await sw(owner, "setChogCollection", [CHOG]);
  for (const w of [alice, bob, carol, dave]) { await approve(w, NFT); await approve(w, NFT2); }
});
const fresh = () => ++id;

test("constructor + defaults", async () => {
  assert.equal(await read(S, "ChogSweeper", "platformFee"), FEE);
  assert.equal(await read(S, "ChogSweeper", "PARTNER_MAX_TIERS"), 4n);
  assert.equal(await read(S, "ChogSweeper", "isVerified", [NFT]), true);
  assert.equal(await read(S, "ChogSweeper", "isVerified", [addr(alice)]), false);
});

test("maker pays fee on creation; taker pays exactly wantedMon; fee kept on accept", async () => {
  const a = fresh(), b = fresh();
  await mint(NFT, addr(alice), a); await mint(NFT2, addr(bob), b);
  const makerBefore = await bal(addr(alice));
  await create(alice, { taker: addr(bob), offered: [asset(NFT, a)], wanted: [asset(NFT2, b)] });
  const tid = await read(S, "ChogSweeper", "tradeCount");
  assert.equal((await trade(tid)).fee, FEE);
  assert.equal(await bal(S), FEE); // only the fee is held in MON
  await sw(bob, "acceptSwap", [tid], 0n); // taker pays nothing extra
  assert.equal(await ownerOf(NFT, a), addr(bob));
  assert.equal(await ownerOf(NFT2, b), addr(alice));
  assert.equal(await read(S, "ChogSweeper", "accruedFees"), FEE);
  const t0 = await bal(addr(treasury));
  await sw(carol, "withdrawFees", []);
  assert.equal((await bal(addr(treasury))) - t0, FEE);
  assert.equal(await bal(S), 0n);
  assert.ok(makerBefore - (await bal(addr(alice))) >= FEE);
});

test("creation value must equal offeredMon + fee exactly", async () => {
  const a = fresh(); await mint(NFT, addr(alice), a);
  const exp = BigInt((await now()) + 3600);
  for (const v of [0n, FEE - 1n, FEE + 1n]) await reverts(swr(alice, "createSwap", [Z, [asset(NFT, a)], [], 0n, 0n, exp], v), /WrongValue/);
  await reverts(swr(alice, "createSwap", [Z, [], [], parseEther("1"), 0n, exp], parseEther("1")), /WrongValue/); // forgot the fee
});

test("cancel refunds escrow AND fee", async () => {
  const a = fresh(); await mint(NFT, addr(alice), a);
  const before = await bal(S);
  await create(alice, { offered: [asset(NFT, a)], offeredMon: parseEther("2") });
  const tid = await read(S, "ChogSweeper", "tradeCount");
  assert.equal((await bal(S)) - before, parseEther("2") + FEE);
  const accruedBefore = await read(S, "ChogSweeper", "accruedFees");
  const r = await sw(alice, "cancelSwap", [tid]);
  assert.equal(await bal(S), before);
  assert.equal(await ownerOf(NFT, a), addr(alice));
  assert.equal(await read(S, "ChogSweeper", "accruedFees"), accruedBefore); // no fee kept
  assert.equal((await trade(tid)).status, 3);
});

test("decline refunds escrow AND fee to the maker", async () => {
  const a = fresh(); await mint(NFT, addr(alice), a);
  await create(alice, { taker: addr(bob), offered: [asset(NFT, a)], offeredMon: parseEther("1") });
  const tid = await read(S, "ChogSweeper", "tradeCount");
  const m0 = await bal(addr(alice));
  await reverts(swr(carol, "declineSwap", [tid]), /UnauthorizedTaker/);
  await sw(bob, "declineSwap", [tid]);
  assert.equal((await bal(addr(alice))) - m0, parseEther("1") + FEE);
  assert.equal(await ownerOf(NFT, a), addr(alice));
});

test("cancel works after expiry and still refunds the fee", async () => {
  const a = fresh(); await mint(NFT, addr(alice), a);
  await create(alice, { offered: [asset(NFT, a)], expiry: (await now()) + 60 });
  const tid = await read(S, "ChogSweeper", "tradeCount");
  await warp(120);
  await reverts(swr(bob, "acceptSwap", [tid], 0n), /Expired/);
  const m0 = await bal(addr(alice));
  await sw(alice, "cancelSwap", [tid]);
  assert.ok((await bal(addr(alice))) - m0 > FEE - parseEther("0.01"));
});

test("accept: wrong value always reverts (no fee for taker, no overpay)", async () => {
  const a = fresh(); await mint(NFT, addr(alice), a);
  await create(alice, { offered: [asset(NFT, a)], wantedMon: parseEther("3") });
  const tid = await read(S, "ChogSweeper", "tradeCount");
  for (const v of [0n, parseEther("3") - 1n, parseEther("3") + 1n, parseEther("3") + FEE]) await reverts(swr(bob, "acceptSwap", [tid], v), /WrongValue/);
  const m0 = await bal(addr(alice));
  await sw(bob, "acceptSwap", [tid], parseEther("3"));
  assert.equal((await bal(addr(alice))) - m0, parseEther("3")); // maker gets exactly wantedMon
  assert.equal(await ownerOf(NFT, a), addr(bob));
  assert.equal(await read(S, "ChogSweeper", "quoteAcceptance", [BigInt(tid), addr(bob)]), parseEther("3"));
});

test("a fee raised before the tx lands reverts instead of overcharging", async () => {
  const a = fresh(); await mint(NFT, addr(alice), a);
  const exp = BigInt((await now()) + 3600);
  await sw(owner, "setPlatformFee", [FEE * 2n]);
  try { await reverts(swr(alice, "createSwap", [Z, [asset(NFT, a)], [], 0n, 0n, exp], FEE), /WrongValue/); }
  finally { await sw(owner, "setPlatformFee", [FEE]); }
});

test("existing trades keep the fee they paid when the fee changes", async () => {
  const a = fresh(); await mint(NFT, addr(alice), a);
  await create(alice, { offered: [asset(NFT, a)] });
  const tid = await read(S, "ChogSweeper", "tradeCount");
  await sw(owner, "setPlatformFee", [FEE * 5n]);
  assert.equal((await trade(tid)).fee, FEE);
  const m0 = await bal(addr(alice));
  await sw(alice, "cancelSwap", [tid]);
  assert.ok((await bal(addr(alice))) - m0 > FEE - parseEther("0.01") && (await bal(addr(alice))) - m0 <= FEE);
  await sw(owner, "setPlatformFee", [FEE]);
});

test("only verified collections, on both sides", async () => {
  const hostile = await deploy("FakeNFT", owner);
  const a = fresh(); await mint(NFT, addr(alice), a);
  const exp = BigInt((await now()) + 3600);
  await reverts(swr(alice, "createSwap", [Z, [asset(hostile, 1)], [], 0n, 0n, exp], FEE), /UnverifiedCollection/);
  await reverts(swr(alice, "createSwap", [Z, [asset(NFT, a)], [asset(hostile, 1)], 0n, 0n, exp], FEE), /UnverifiedCollection/);
  await reverts(swr(alice, "createSwap", [Z, [asset(addr(bob), 1)], [], 0n, 0n, exp], FEE), /UnverifiedCollection/);
  // once verified it works; un-verifying blocks new trades again
  await sw(owner, "setVerifiedCollections", [[hostile], true]);
  await reverts(swr(alice, "createSwap", [Z, [asset(hostile, 1)], [], 0n, 0n, exp], FEE), /EscrowDepositFailed|revert/i); // fake NFT cannot even deposit
  await sw(owner, "setVerifiedCollections", [[hostile], false]);
  assert.equal(await read(S, "ChogSweeper", "isVerified", [hostile]), false);
});

test("verified list: owner only, EOAs cannot be added", async () => {
  await reverts(swr(alice, "setVerifiedCollections", [[NFT], true]), /OwnableUnauthorizedAccount/);
  await reverts(swr(owner, "setVerifiedCollections", [[addr(bob)], true]), /InvalidAsset/);
  await sw(owner, "setVerifiedCollections", [[addr(bob)], false]); // removing anything is fine
});

test("un-verifying a collection never traps an existing trade", async () => {
  const a = fresh(); await mint(NFT2, addr(alice), a);
  await create(alice, { offered: [asset(NFT2, a)] });
  const tid = await read(S, "ChogSweeper", "tradeCount");
  await sw(owner, "setVerifiedCollections", [[NFT2], false]);
  await sw(alice, "cancelSwap", [tid]);
  assert.equal(await ownerOf(NFT2, a), addr(alice));
  await sw(owner, "setVerifiedCollections", [[NFT2], true]);
});

test("Chog holder (maker) pays no fee; fee returns once the Chog is sold", async () => {
  const c = fresh(); await mint(CHOG, addr(dave), c);
  assert.equal(await read(S, "ChogSweeper", "feeFor", [addr(dave)]), 0n);
  const a = fresh(); await mint(NFT, addr(dave), a);
  const bal0 = await bal(S);
  await create(dave, { offered: [asset(NFT, a)] });
  assert.equal(await bal(S), bal0); // nothing sent
  const tid = await read(S, "ChogSweeper", "tradeCount");
  assert.equal((await trade(tid)).fee, 0n);
  await sw(dave, "cancelSwap", [tid]);
  await call(dave, CHOG, "MockNFT", "transferFrom", [addr(dave), addr(carol), BigInt(c)]);
  assert.equal(await read(S, "ChogSweeper", "feeFor", [addr(dave)]), FEE);
  await call(carol, CHOG, "MockNFT", "transferFrom", [addr(carol), addr(dave), BigInt(c)]);
});

test("partner tiers: 25% off per token, 100% at four, Chog beats partner", async () => {
  await sw(owner, "setPartnerCollection", [PARTNER]);
  const w = carol;
  const expected = [FEE, (FEE * 3n) / 4n, FEE / 2n, FEE / 4n, 0n, 0n];
  for (let held = 0; held < expected.length; held++) {
    if (held > 0) await mint(PARTNER, addr(w), fresh());
    assert.equal(await read(S, "ChogSweeper", "feeFor", [addr(w)]), expected[held], `held=${held}`);
  }
  // the quote follows
  assert.equal(await read(S, "ChogSweeper", "quoteCreation", [addr(w), 5n]), 5n);
  await sw(owner, "setPartnerCollection", [Z]);
  assert.equal(await read(S, "ChogSweeper", "feeFor", [addr(w)]), FEE);
});

test("partial tier is charged and recorded exactly", async () => {
  await sw(owner, "setPartnerCollection", [PARTNER]);
  const w = bob; // give bob 2 partner tokens
  await mint(PARTNER, addr(w), fresh()); await mint(PARTNER, addr(w), fresh());
  const a = fresh(); await mint(NFT, addr(w), a);
  await create(w, { offered: [asset(NFT, a)] });
  const tid = await read(S, "ChogSweeper", "tradeCount");
  assert.equal((await trade(tid)).fee, FEE / 2n);
  await sw(w, "cancelSwap", [tid]);
  await sw(owner, "setPartnerCollection", [Z]);
});

test("promotion window waives the fee, inclusive, and can end early", async () => {
  const until = BigInt((await now()) + 100);
  await sw(owner, "setFeeWaivedUntil", [until]);
  assert.equal(await read(S, "ChogSweeper", "feeFor", [addr(alice)]), 0n);
  await sw(owner, "setFeeWaivedUntil", [0n]);
  assert.equal(await read(S, "ChogSweeper", "feeFor", [addr(alice)]), FEE);
});

test("hostile holder contracts never block creation (counted as non-holder)", async () => {
  for (const name of ["GasBurner", "Garbage", "Reverting", "FakeNFT"]) {
    const h = await deploy(name, owner);
    await sw(owner, "setChogCollection", [h]);
    await sw(owner, "setPartnerCollection", [h]);
    assert.equal(await read(S, "ChogSweeper", "feeFor", [addr(alice)]), FEE, name);
  }
  await sw(owner, "setChogCollection", [CHOG]);
  await sw(owner, "setPartnerCollection", [Z]);
  // and an EOA as the collection
  await sw(owner, "setChogCollection", [addr(bob)]);
  assert.equal(await read(S, "ChogSweeper", "feeFor", [addr(alice)]), FEE);
  await sw(owner, "setChogCollection", [CHOG]);
});

test("gift, MON-only, request-only shapes", async () => {
  const a = fresh(); await mint(NFT, addr(alice), a);
  await create(alice, { offered: [asset(NFT, a)] }); // gift
  let tid = await read(S, "ChogSweeper", "tradeCount");
  await sw(bob, "acceptSwap", [tid], 0n);
  assert.equal(await ownerOf(NFT, a), addr(bob));
  // MON-only offer for an NFT
  const b = fresh(); await mint(NFT, addr(bob), b);
  const b0 = await bal(addr(bob));
  await create(carol, { offeredMon: parseEther("4"), wanted: [asset(NFT, b)] });
  tid = await read(S, "ChogSweeper", "tradeCount");
  await sw(bob, "acceptSwap", [tid], 0n);
  assert.ok((await bal(addr(bob))) - b0 > parseEther("3.99"));
  assert.equal(await ownerOf(NFT, b), addr(carol));
});

test("validation: nothing offered, self trade, expiry, too many assets", async () => {
  const exp = BigInt((await now()) + 3600);
  await reverts(swr(alice, "createSwap", [Z, [], [asset(NFT, 1)], 0n, 0n, exp], FEE), /NothingOffered/);
  await reverts(swr(alice, "createSwap", [addr(alice), [], [], 1n, 0n, exp], FEE + 1n), /SelfTrade/);
  await reverts(swr(alice, "createSwap", [Z, [], [], 1n, 0n, BigInt(await now())], FEE + 1n), /InvalidExpiry/);
  const eleven = Array.from({ length: 11 }, (_, i) => asset(NFT, 900000 + i));
  await reverts(swr(alice, "createSwap", [Z, eleven, [], 0n, 0n, exp], FEE), /TooManyAssets/);
  await reverts(swr(alice, "createSwap", [Z, [], eleven, 1n, 0n, exp], FEE + 1n), /TooManyAssets/);
});

test("10-for-10 bundle with MON on both sides settles atomically", async () => {
  const mine = [], theirs = [];
  for (let i = 0; i < 10; i++) { const x = fresh(), y = fresh(); await mint(NFT, addr(alice), x); await mint(NFT2, addr(bob), y); mine.push(asset(NFT, x)); theirs.push(asset(NFT2, y)); }
  await create(alice, { taker: addr(bob), offered: mine, wanted: theirs, offeredMon: parseEther("1"), wantedMon: parseEther("2") });
  const tid = await read(S, "ChogSweeper", "tradeCount");
  await sw(bob, "acceptSwap", [tid], parseEther("2"));
  for (const m of mine) assert.equal(await ownerOf(m.nft, m.tokenId), addr(bob));
  for (const t of theirs) assert.equal(await ownerOf(t.nft, t.tokenId), addr(alice));
  const done = await trade(tid);
  assert.equal(done.offered.length, 0); assert.equal(done.status, 2);
});

test("accept without approval or ownership reverts atomically (nothing moves, fee stays escrowed)", async () => {
  const x = fresh(), y = fresh(); await mint(NFT, addr(alice), x); await mint(NFT2, addr(dave), y);
  await call(dave, NFT2, "MockNFT", "setApprovalForAll", [S, false]);
  await create(alice, { offered: [asset(NFT, x)], wanted: [asset(NFT2, y)] });
  const tid = await read(S, "ChogSweeper", "tradeCount");
  await reverts(swr(dave, "acceptSwap", [tid], 0n), /revert|ERC721/i);
  assert.equal(await ownerOf(NFT, x), getAddress(S));
  assert.equal((await trade(tid)).status, 1);
  await sw(alice, "cancelSwap", [tid]);
  await call(dave, NFT2, "MockNFT", "setApprovalForAll", [S, true]);
});

test("solvency: contract balance == escrowed MON + unwithdrawn fees after a mixed run", async () => {
  // drain pending fees first
  if ((await read(S, "ChogSweeper", "accruedFees")) > 0n) await sw(alice, "withdrawFees", []);
  const open = [];
  for (let i = 0; i < 6; i++) {
    const mon = parseEther(String(i + 1));
    await create([alice, bob, carol][i % 3], { offeredMon: mon, wantedMon: i % 2 ? 7n : 0n });
    open.push([await read(S, "ChogSweeper", "tradeCount"), mon]);
  }
  await sw(dave, "acceptSwap", [open[0][0]], 0n);          // accepted: fee accrues, MON leaves
  await sw(dave, "acceptSwap", [open[1][0]], 7n);
  await sw(carol, "cancelSwap", [open[2][0]]);             // cancelled by its maker (index 2 -> carol)
  let escrow = 0n;
  for (const [tid, mon] of open) { const t = await trade(tid); if (t.status === 1) escrow += mon + t.fee; }
  assert.equal(await bal(S), escrow + (await read(S, "ChogSweeper", "accruedFees")));
});

test("getTrade exposes the fee; unknown ids; ownership is two-step", async () => {
  await reverts(readRevert("quoteAcceptance", [987654321n, addr(alice)]), /TradeNotFound/);
  await reverts(swr(alice, "cancelSwap", [987654321n]), /TradeNotFound/);
  await sw(owner, "transferOwnership", [addr(alice)]);
  assert.equal(await read(S, "ChogSweeper", "owner"), addr(owner));
  await sw(alice, "acceptOwnership", []);
  assert.equal(await read(S, "ChogSweeper", "owner"), addr(alice));
  await sw(alice, "transferOwnership", [addr(owner)]); await sw(owner, "acceptOwnership", []);
});

test("MockCollection: batch mint, on-chain metadata, tradable once verified, and a cross-collection swap", async () => {
  const MC = await deploy("MockCollection", owner, ["Mock Molandak", "MMOLA", 150n]);
  await call(owner, MC, "MockCollection", "mintBatch", [addr(alice), 5n]);
  assert.equal(await read(MC, "MockCollection", "balanceOf", [addr(alice)]), 5n);
  await reverts(call(owner, MC, "MockCollection", "mintBatch", [addr(alice), 11n]), /InvalidBatchSize|revert/);
  const uri = await read(MC, "MockCollection", "tokenURI", [3n]);
  const meta = JSON.parse(Buffer.from(uri.replace("data:application/json;base64,", ""), "base64").toString());
  assert.equal(meta.name, "Mock Molandak #3");
  assert.match(meta.image, /^data:image\/svg\+xml;base64,/);

  // not verified yet: the contract refuses it
  await call(alice, MC, "MockCollection", "setApprovalForAll", [S, true]);
  const b = fresh(); await mint(NFT2, addr(bob), b);
  await reverts(create(alice, { taker: addr(bob), offered: [asset(MC, 1)], wanted: [asset(NFT2, b)] }), /UnverifiedCollection|revert/);

  await sw(owner, "setVerifiedCollections", [[MC], true]);
  await create(alice, { taker: addr(bob), offered: [asset(MC, 1)], wanted: [asset(NFT2, b)] });
  const tid = await read(S, "ChogSweeper", "tradeCount");
  await sw(bob, "acceptSwap", [tid], 0n);
  assert.equal(await read(MC, "MockCollection", "ownerOf", [1n]), addr(bob));
  assert.equal(await ownerOf(NFT2, b), addr(alice));
});
