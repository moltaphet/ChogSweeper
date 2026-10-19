import { log } from "./log.js";

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/** Exponential backoff with full jitter. */
export function backoffMs(attempt: number, base = 500, max = 30_000): number {
  const ceiling = Math.min(max, base * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

/** Retries `fn` a bounded number of times; rethrows the last error. */
export async function retry<T>(fn: () => Promise<T>, opts: { retries: number; base?: number; max?: number; what: string; signal?: AbortSignal }): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= opts.retries || opts.signal?.aborted) throw e;
      const wait = backoffMs(attempt, opts.base, opts.max);
      log.warn("retrying", { what: opts.what, attempt: attempt + 1, waitMs: wait, err: String(e) });
      await sleep(wait, opts.signal);
    }
  }
}

/**
 * Runs `fn` forever, restarting it with exponential backoff whenever it throws or returns.
 * The backoff resets once a run stays healthy for `healthyAfterMs`.
 */
export async function supervise(name: string, fn: () => Promise<void>, signal: AbortSignal, healthyAfterMs = 60_000): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    const started = Date.now();
    try {
      await fn();
      if (signal.aborted) return;
      log.warn("task returned unexpectedly, restarting", { task: name });
    } catch (e) {
      if (signal.aborted) return;
      log.error("task crashed", { task: name, err: e instanceof Error ? e.stack ?? e.message : String(e) });
    }
    failures = Date.now() - started > healthyAfterMs ? 0 : failures + 1;
    const wait = backoffMs(failures, 1000, 60_000);
    log.warn("restarting task", { task: name, inMs: wait, consecutiveFailures: failures });
    await sleep(wait, signal);
  }
}
