import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium as pwChromium } from "playwright";
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Same as playwright's chromium, but honours CHROME_PATH (a system Chrome/Chromium) when set. */
export const chromium = { launch: (o = {}) => pwChromium.launch({ ...o, executablePath: process.env.CHROME_PATH || undefined }) };
export const info = JSON.parse(fs.readFileSync(path.join(HERE, "chain.json"), "utf8"));
export const BASE = process.env.BASE ?? "http://localhost:3102";
export const rpc = async (method, params = []) => {
  const r = await (await fetch("http://127.0.0.1:8545", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
  if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; e.data = r.error.data; throw e; }
  return r.result;
};
export const bal = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]));
export const call = async (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

/** A page with a fake injected wallet (EIP-1193) that signs through ganache's unlocked accounts. */
export async function walletPage(browser, accountIndex, { width = 1440, height = 1000, clockOffsetMs = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error") logs.push("console: " + m.text()); });
  page.on("pageerror", (e) => logs.push("pageerror: " + String(e)));
  await page.exposeFunction("__rpc", async (method, params) => {
    try { return { ok: true, result: await rpc(method, params) }; } catch (e) { return { ok: false, message: e.message, code: e.code, data: e.data }; }
  });
  if (clockOffsetMs) await page.addInitScript((off) => { const n = Date.now.bind(Date); Date.now = () => n() + off; }, clockOffsetMs);
  await page.addInitScript(({ accounts, index }) => {
    let current = accounts[index];
    const listeners = {};
    const emit = (ev, ...a) => (listeners[ev] ?? []).forEach((f) => f(...a));
    window.__setAccount = (i) => { current = accounts[i]; emit("accountsChanged", [current]); };
    window.__txs = [];
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params = [] }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [current];
        if (method === "eth_chainId") return "0x279f";
        if (method === "net_version") return "10143";
        if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
        if (method === "wallet_getPermissions" || method === "wallet_requestPermissions") return [{ parentCapability: "eth_accounts" }];
        if (method === "eth_sendTransaction") {
          params = [{ ...params[0], from: current }];
          if (!params[0].gas) { // like a real wallet: estimate, with a safety margin (ganache would otherwise default to 90000)
            const est = await window.__rpc("eth_estimateGas", [params[0]]);
            if (est.ok) params[0].gas = "0x" + Math.ceil(parseInt(est.result, 16) * 1.3).toString(16);
          }
          window.__txs.push(params[0]);
        }
        const r = await window.__rpc(method, params);
        if (!r.ok) { const e = new Error(r.message); e.code = r.code ?? -32000; e.data = r.data; throw e; }
        return r.result;
      },
      on: (ev, f) => { (listeners[ev] ??= []).push(f); },
      removeListener: (ev, f) => { listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== f); },
    };
  }, { accounts: info.accounts, index: accountIndex });
  return { ctx, page, logs };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const results = [];
export const check = (cond, name, extra = "") => { results.push({ ok: !!cond, name }); console.log((cond ? "  ✓ " : "  ✗ FAIL: ") + name + (extra ? "  (" + extra + ")" : "")); return !!cond; };

/** After a page load: if the saved wallet reconnects by itself do nothing, otherwise press "Connect wallet". */
export async function ensureConnected(page) {
  await sleep(2000);
  const btn = page.getByRole("button", { name: /Connect wallet/i }).first();
  if (await btn.count()) await btn.click({ timeout: 5000 }).catch(() => {});
  await sleep(500);
}
