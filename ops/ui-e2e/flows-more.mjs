import { chromium, info, BASE, walletPage, check, sleep, bal, call, rpc, results, ensureConnected } from "./ui-lib.mjs";
import { encodeFunctionData, decodeFunctionResult, parseEther, formatEther } from "viem";
import fs from "node:fs";
const art = JSON.parse(fs.readFileSync(new URL("../contract-tests/artifacts.json", import.meta.url), "utf8"));
const S = info.sweeper, CH = info.chog, OTHER = info.other;
const [, , A, B, C] = info.accounts;
const sweeper = (fn, args = []) => call(S, encodeFunctionData({ abi: art.ChogSweeper.abi, functionName: fn, args })).then((d) => decodeFunctionResult({ abi: art.ChogSweeper.abi, functionName: fn, data: d }));
const ownerOf = (id) => call(CH, encodeFunctionData({ abi: art.MockChog.abi, functionName: "ownerOf", args: [BigInt(id)] })).then((d) => decodeFunctionResult({ abi: art.MockChog.abi, functionName: "ownerOf", data: d })).then((x) => x.toLowerCase());
const near = (a, b, tol = parseEther("0.02")) => (a > b ? a - b : b - a) <= tol;
const b = await chromium.launch();
const allLogs = [];
const shot = (p, n) => p.screenshot({ path: `${process.env.SHOTS_DIR ?? "/tmp"}/ui-e2e-${n}.png` });
const give = 'section[aria-labelledby="give-heading"]', recv = 'section[aria-labelledby="receive-heading"]';
const connect = async (page, sel = give + ' [role="option"]') => { await page.getByRole("button", { name: /Connect wallet/i }).first().click(); await page.waitForSelector(sel, { timeout: 30000 }).catch(() => {}); };
const open = async (idx, path, o = {}) => { const w = await walletPage(b, idx, o); allLogs.push(w.logs); await w.page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {}); return w.page; };
const lastId = async () => Number(await sweeper("tradeCount"));

console.log("\n== Flow 2: a wallet WITHOUT a Chog pays the fee; cancelling refunds it ==");
{
  const page = await open(4, "/launchpad?tab=new");
  await connect(page, "text=Connect a wallet");
  await sleep(1500);
  await page.getByLabel("Add MON sweetener").fill("1");
  await page.getByPlaceholder(/0x… or name\.eth/).fill(B);
  await page.waitForSelector(recv + ' [role="option"]', { timeout: 30000 });
  await page.locator(recv + ' [role="option"]').first().click();
  await sleep(2000);
  const feeText = (await page.getByText(/Platform fee:/).first().innerText()).replace(/\s+/g, " ");
  check(/0\.05/.test(feeText), "UI shows the 0.05 MON fee for a wallet without a Chog", feeText);
  const balC0 = await bal(C), contract0 = await bal(S);
  await page.getByRole("button", { name: /Send swap offer/ }).click();
  await page.getByText(/Trade created/).waitFor({ timeout: 30000 }).then(() => check(true, "UI shows 'Trade created'")).catch(() => check(false, "UI shows 'Trade created'"));
  const id = await lastId(); const t = await sweeper("getTrade", [BigInt(id)]);
  check(t[6] === parseEther("0.05"), "trade records the 0.05 fee", formatEther(t[6]));
  check(t[4] === parseEther("1"), "trade escrows exactly 1 MON");
  check((await bal(S)) - contract0 === parseEther("1.05"), "contract received 1.05 MON (1 escrow + 0.05 fee)");
  check(near(balC0 - (await bal(C)), parseEther("1.05")), "creator paid ~1.05 MON plus gas");
  await shot(page, "f2_created");
  await page.goto(`${BASE}/launchpad?tab=requests`, { waitUntil: "networkidle" }).catch(() => {});
  await ensureConnected(page);
  const cancel = page.getByRole("button", { name: /Cancel offer/ }).first();
  await cancel.waitFor({ timeout: 30000 });
  const balBefore = await bal(C);
  await cancel.click();
  await sleep(6000);
  check((await sweeper("getTrade", [BigInt(id)]))[2] === 3, "trade is Cancelled on chain");
  check(near((await bal(C)) - balBefore, parseEther("1.05")), "cancel refunded escrow AND fee (~1.05 MON back)");
  check((await bal(S)) === contract0, "contract balance is back to what it was");
  await shot(page, "f2_cancelled");
}

console.log("\n== Flow 3: B declines a gift from A; A gets the Chog back ==");
{
  const page = await open(2, "/launchpad?tab=new");
  await connect(page);
  const firstId = await page.locator(give + ' [role="option"]').first().innerText();
  await page.locator(give + ' [role="option"]').first().click();
  const picked = (firstId.match(/#(\d+)/) ?? [])[1];
  await page.getByPlaceholder(/0x… or name\.eth/).fill(B);
  await sleep(2500);
  await page.getByRole("button", { name: /Send swap offer/ }).click();
  await page.getByText(/Trade created/).waitFor({ timeout: 30000 }).catch(() => {});
  const id = await lastId();
  check((await ownerOf(picked)) === S.toLowerCase(), `Chog #${picked} is escrowed`);
  const pb = await open(3, "/launchpad?tab=requests");
  await ensureConnected(pb);
  const decline = pb.getByRole("button", { name: /^Decline/ }).first();
  await decline.waitFor({ timeout: 30000 });
  await decline.click();
  await sleep(6000);
  check((await sweeper("getTrade", [BigInt(id)]))[2] === 4, "trade is Declined on chain");
  check((await ownerOf(picked)) === A.toLowerCase(), `Chog #${picked} is back with A`);
  await shot(pb, "f3_declined");
}

console.log("\n== Flow 4: a Public Open Trade can be posted from the UI ==");
{
  const page = await open(2, "/launchpad?tab=new&mode=open");
  await connect(page);
  await page.locator(give + ' [role="option"]').first().click();
  await page.getByLabel("Request MON").fill("0.25");
  await sleep(1500);
  await page.getByRole("button", { name: /Post public trade/ }).click();
  await page.getByText(/Trade created/).waitFor({ timeout: 30000 }).then(() => check(true, "UI shows 'Trade created' for the public trade")).catch(() => check(false, "UI shows 'Trade created' for the public trade"));
  const id = await lastId(); const t = await sweeper("getTrade", [BigInt(id)]);
  check(t[1] === "0x0000000000000000000000000000000000000000", "public trade has no designated taker");
  check(t[5] === parseEther("0.25"), "it asks for exactly 0.25 MON");
  await shot(page, "f4_open");
}

console.log("\n== Flow 5: a collection that is NOT verified is refused ==");
{
  const page = await open(4, "/launchpad?tab=new");
  await connect(page, "text=Connect a wallet");
  await sleep(1200);
  await page.getByRole("button", { name: /Can.t see an NFT/ }).first().click();
  await page.getByPlaceholder("0x…").first().fill(OTHER);
  await page.getByPlaceholder("123").first().fill("1");
  await page.getByRole("button", { name: /Add NFT/ }).click();
  await page.getByPlaceholder(/0x… or name\.eth/).fill(B);
  await page.waitForFunction(() => /Only verified collections can be traded/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  const text = await page.locator("body").innerText();
  check(/Only verified collections can be traded/.test(text), "UI explains that only verified collections can be traded");
  const approve = page.getByRole("button", { name: /Approve NFTs/ });
  const send = page.getByRole("button", { name: /Send swap offer/ });
  const blocked = (await approve.isDisabled().catch(() => null)) ?? (await send.isDisabled().catch(() => false));
  check(blocked === true, "neither Approve nor Send is clickable for an unverified collection");
  await shot(page, "f5_unverified");
}

console.log("\n== Flow 6: an expired offer shows a Reclaim button and returns the assets ==");
{
  const page = await open(2, "/launchpad?tab=new");
  await connect(page);
  await sleep(2500);
  // Pick a token A really holds right now (the list can briefly lag behind escrowed tokens).
  const opts = page.locator(give + ' [role="option"]');
  let picked = null, idx = -1;
  for (let i = 0; i < await opts.count(); i++) {
    const id = ((await opts.nth(i).innerText()).match(/#(\d+)/) ?? [])[1];
    if (id && (await ownerOf(id)) === A.toLowerCase()) { picked = id; idx = i; break; }
  }
  check(picked !== null, "A has a Chog available to offer");
  await opts.nth(idx).click();
  await page.getByPlaceholder(/0x… or name\.eth/).fill(B);
  await sleep(2000);
  await page.locator("select").first().selectOption({ label: "1 hour" });
  await page.getByRole("button", { name: /Send swap offer/ }).click();
  await page.getByText(/Trade created/).waitFor({ timeout: 30000 }).catch(() => {});
  const id = await lastId();
  await rpc("evm_increaseTime", [3 * 3600]); await rpc("evm_mine", []);
  const p2 = await open(2, "/launchpad?tab=requests", { clockOffsetMs: 3 * 3600 * 1000 });
  await ensureConnected(p2);
  await p2.getByText(/Expired/).first().waitFor({ timeout: 30000 }).then(() => check(true, "the offer is shown as Expired")).catch(() => check(false, "the offer is shown as Expired"));
  const body = await p2.locator("body").innerText();
  check(/still held in escrow|expired and their assets|Reclaim/i.test(body), "the UI tells the maker the assets are still in escrow");
  const reclaim = p2.getByRole("button", { name: /Reclaim assets/ }).first();
  check(await reclaim.isVisible().catch(() => false), "a 'Reclaim assets' button is offered");
  await shot(p2, "f6_expired");
  await reclaim.click().catch(() => {});
  await sleep(6000);
  check((await sweeper("getTrade", [BigInt(id)]))[2] === 3, "reclaiming cancels the trade on chain");
  check((await ownerOf(picked)) === A.toLowerCase(), `Chog #${picked} is back with A`);
}

for (const l of allLogs) for (const m of l) if (!/503|Failed to load resource|stats/.test(m)) console.log("  ! browser:", m.slice(0, 220));
await b.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log("FAILED:", failed.map((f) => f.name));
process.exit(failed.length ? 1 : 0);
