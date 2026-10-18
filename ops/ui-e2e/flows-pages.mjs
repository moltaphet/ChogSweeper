import { chromium, info, BASE, walletPage, check, sleep, results } from "./ui-lib.mjs";
const b = await chromium.launch();
const ignore = /503|Failed to load resource|\/api\/stats|stats:/;
const tabs = ["", "?tab=new", "?tab=requests", "?tab=history", "?tab=public", "?tab=collections", "?tab=activity", "?tab=lookup", "?tab=faucet"];
for (const [label, idx, width] of [["desktop, wallet connected", 3, 1440], ["mobile, wallet connected", 3, 390], ["desktop, no wallet", null, 1440]]) {
  console.log(`\n== ${label} ==`);
  const { page, logs } = idx === null ? await (async () => { const ctx = await b.newContext({ viewport: { width, height: 900 } }); const p = await ctx.newPage(); const l = []; p.on("console", (m) => m.type() === "error" && l.push("console: " + m.text())); p.on("pageerror", (e) => l.push("pageerror: " + e)); return { page: p, logs: l }; })() : await walletPage(b, idx, { width, height: 900 });
  await page.goto(`${BASE}/launchpad`, { waitUntil: "networkidle" }).catch(() => {});
  if (idx !== null) { await page.getByRole("button", { name: /Connect|No wallet/i }).first().click().catch(() => {}); await sleep(1500); }
  for (const t of tabs) {
    logs.length = 0;
    await page.goto(`${BASE}/launchpad${t}`, { waitUntil: "networkidle" }).catch(() => {});
    await sleep(1800);
    const real = logs.filter((l) => !ignore.test(l));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(real.length === 0 && overflow <= 1, `${t || "overview"}: no errors, no sideways scroll`, real.length ? real[0].slice(0, 140) : overflow > 1 ? `overflow ${overflow}px` : "");
  }
  logs.length = 0;
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" }).catch(() => {});
  await sleep(4500);
  const real = logs.filter((l) => !ignore.test(l));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(real.length === 0 && overflow <= 1, "landing page: no errors, no sideways scroll", real.length ? real[0].slice(0, 140) : overflow > 1 ? `overflow ${overflow}px` : "");
  await page.close();
}
await b.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
