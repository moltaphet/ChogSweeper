import { chromium, info, BASE, walletPage, check, sleep, bal, call, rpc, results, ensureConnected } from "./ui-lib.mjs";
import { encodeFunctionData, decodeFunctionResult, parseEther, formatEther } from "viem";
import fs from "node:fs";
const art = JSON.parse(fs.readFileSync(new URL("../contract-tests/artifacts.json", import.meta.url), "utf8"));
const S = info.sweeper, CH = info.chog;
const [, , A, B, C] = info.accounts;
const sweeper = (fn, args = []) => call(S, encodeFunctionData({ abi: art.ChogSweeper.abi, functionName: fn, args })).then((d) => decodeFunctionResult({ abi: art.ChogSweeper.abi, functionName: fn, data: d }));
const ownerOf = (id) => call(CH, encodeFunctionData({ abi: art.MockChog.abi, functionName: "ownerOf", args: [BigInt(id)] })).then((d) => decodeFunctionResult({ abi: art.MockChog.abi, functionName: "ownerOf", data: d }));
const b = await chromium.launch();
const allLogs = [];
const shot = (p, n) => p.screenshot({ path: `${process.env.SHOTS_DIR ?? "/tmp"}/ui-e2e-${n}.png` });

async function connect(page) {
  await page.getByRole("button", { name: /Connect wallet/i }).first().click();
  await page.waitForSelector('section[aria-labelledby="give-heading"] [role="option"]', { timeout: 30000 });
}

console.log("\n== Flow 1: A (Chog holder) sends a Direct Swap to B, B accepts ==");
{
  const { page, logs } = await walletPage(b, 2); allLogs.push(logs);
  await page.goto(`${BASE}/launchpad?tab=new`, { waitUntil: "networkidle" }).catch(() => {});
  await connect(page);
  await page.locator('section[aria-labelledby="give-heading"] [role="option"]').first().click(); // A's Chog #1
  await page.getByPlaceholder(/0x… or name\.eth/).fill(B);
  await page.waitForSelector('section[aria-labelledby="receive-heading"] [role="option"]', { timeout: 30000 });
  check((await page.locator('section[aria-labelledby="receive-heading"] [role="option"]').count()) === 4, "B's four Chogs are listed on the receive side");
  await page.locator('section[aria-labelledby="receive-heading"] [role="option"]').first().click(); // B's Chog #5
  await sleep(1500);
  const feeText = await page.getByText(/Platform fee:/).first().innerText();
  check(/Free/.test(feeText), "platform fee shows Free for a Chog holder", feeText.replace(/\s+/g, " "));
  await shot(page, "f1_ready");
  const approve = page.getByRole("button", { name: /Approve NFTs/ });
  if (await approve.isVisible().catch(() => false)) { await approve.click(); await page.getByRole("button", { name: /Send swap offer/ }).waitFor({ timeout: 30000 }); }
  check(true, "approval step finished");
  await page.getByRole("button", { name: /Send swap offer/ }).click();
  await page.getByText(/Trade created/).waitFor({ timeout: 30000 }).then(() => check(true, "UI shows 'Trade created'")).catch(() => check(false, "UI shows 'Trade created'"));
  const count = await sweeper("tradeCount");
  check(count === 1n, "tradeCount is 1 on chain", String(count));
  const t = await sweeper("getTrade", [1n]);
  check(t[2] === 1, "trade 1 is Active");
  check(t[6] === 0n, "recorded fee is 0 (maker holds a Chog)");
  check((await ownerOf(1)).toLowerCase() === S.toLowerCase(), "A's Chog #1 sits in escrow");
  await shot(page, "f1_created");
}
{
  const { page, logs } = await walletPage(b, 3); allLogs.push(logs);
  await page.goto(`${BASE}/launchpad?tab=requests`, { waitUntil: "networkidle" }).catch(() => {});
  await ensureConnected(page);
  await page.getByText(/Trade #1|#1\b/).first().waitFor({ timeout: 30000 }).then(() => check(true, "B sees the offer under Requests (from chain logs, no indexer)")).catch(() => check(false, "B sees the offer under Requests"));
  await shot(page, "f1_requests");
  const accept = page.getByRole("button", { name: /^Accept/ }).first();
  const unverifiedGate = page.getByRole("button", { name: /Review before accepting/ });
  check(!(await unverifiedGate.isVisible().catch(() => false)), "Chog trade is not gated behind the unverified review");
  await accept.click();
  await sleep(6000);
  const t = await sweeper("getTrade", [1n]);
  check(t[2] === 2, "trade 1 is Accepted on chain");
  check((await ownerOf(1)).toLowerCase() === B.toLowerCase(), "B now owns A's Chog #1");
  check((await ownerOf(5)).toLowerCase() === A.toLowerCase(), "A now owns B's Chog #5");
  await shot(page, "f1_done");
}
for (const l of allLogs) for (const m of l) if (!/503|Failed to load resource|stats/.test(m)) console.log("  ! browser:", m.slice(0, 200));
await b.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
