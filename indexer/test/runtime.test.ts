import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { workerHealth } from "../src/health.js";
import { createWaker } from "../src/chain.js";
import { sleep } from "../src/retry.js";
import { advanceTransferCoverage, rewindTransfers } from "../src/transfers.js";
import { A, testDb } from "./helpers.js";

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

function config() {
  vi.stubEnv("RPC_URLS", "https://rpc.example.com");
  vi.stubEnv("SWEEPER_ADDRESS", A.chog);
  vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
  return loadConfig();
}

describe("worker configuration", () => {
  it.each(["MAX_BLOCK_RANGE", "POLL_MS", "REWIND_DEPTH", "METADATA_CONCURRENCY"])("rejects a zero %s instead of looping forever", (name) => {
    config(); vi.stubEnv(name, "0"); expect(loadConfig).toThrow(name);
  });
  it("allows zero confirmations but rejects empty endpoints and negative blocks", () => {
    config(); vi.stubEnv("CONFIRMATIONS", "0"); expect(loadConfig().confirmations).toBe(0n);
    vi.stubEnv("RPC_URLS", " , "); expect(loadConfig).toThrow("RPC_URLS");
    vi.stubEnv("RPC_URLS", "https://rpc.example.com");
    vi.stubEnv("SWEEPER_DEPLOY_BLOCK", "-1"); expect(loadConfig).toThrow("SWEEPER_DEPLOY_BLOCK");
  });
});

describe("worker lifecycle", () => {
  it("is unhealthy before both streams run, when stale or when far behind", () => {
    const p = { cursor: "99", head: "100", at: 1000 };
    expect(workerHealth({}, 1000).ok).toBe(false);
    expect(workerHealth({ sweeper: p }, 1000).ok).toBe(false);
    expect(workerHealth({ sweeper: p, transfers: p }, 1000).ok).toBe(true);
    expect(workerHealth({ sweeper: p, transfers: p }, 62000).ok).toBe(false);
    expect(workerHealth({ sweeper: { ...p, head: "500" }, transfers: p }, 1000).ok).toBe(false);
  });
  it("releases timed-out waiters instead of retaining them until shutdown", async () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const waker = createWaker({ ...config(), wsUrl: null, pollMs: 5 });
    for (let i = 0; i < 10; i++) {
      const wait = waker.wake(); await vi.advanceTimersByTimeAsync(5); await wait;
    }
    const cleared = clear.mock.calls.length;
    waker.close();
    expect(clear.mock.calls.length).toBe(cleared);
    await waker.wake();
    expect(vi.getTimerCount()).toBe(0);
    clear.mockRestore();
  });
  it("does not wait on an already aborted signal", async () => {
    vi.useFakeTimers();
    const ac = new AbortController(); ac.abort();
    await sleep(15000, ac.signal);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("transfer coverage", () => {
  it("advances only contiguous history, and reopens backfill even for empty reorg ranges", async () => {
    const db = await testDb();
    await db.query("INSERT INTO nft_collections (address, backfilled_to) VALUES ($1,99),($2,20)", [A.chog, A.nft2]);
    await advanceTransferCoverage(db, 100n, 110n);
    expect((await db.query("SELECT backfilled_to::text AS b FROM nft_collections ORDER BY address")).rows.map((r) => r.b)).toEqual(["110", "20"]);
    await rewindTransfers(db, 90n);
    expect((await db.query("SELECT backfilled_to::text AS b FROM nft_collections WHERE address=$1", [A.chog])).rows[0].b).toBe("89");
    await db.end();
  });
});
