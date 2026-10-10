import { createPublicClient, defineChain, fallback, http, webSocket, type PublicClient } from "viem";
import type { Config } from "./config.js";
import { log } from "./log.js";

export function createChain(cfg: Config) {
  return defineChain({
    id: cfg.chainId,
    name: "Monad",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: cfg.rpcUrls } },
  });
}

/** HTTP client with per-request retries and failover across all configured RPC URLs. */
export function createRpcClient(cfg: Config): PublicClient {
  const transports = cfg.rpcUrls.map((url) => http(url, { retryCount: 4, retryDelay: 200, timeout: 15_000 }));
  return createPublicClient({
    chain: createChain(cfg),
    transport: transports.length > 1 ? fallback(transports, { rank: false }) : transports[0]!,
  }) as PublicClient;
}

export interface Waker {
  /** Resolves on the next new block (WebSocket) or after `pollMs`, whichever comes first. */
  wake(): Promise<void>;
  close(): void;
}

/**
 * A "new block" signal. The WebSocket only reduces latency; the poll timeout means the indexer
 * keeps making progress even if the socket dies silently. A watchdog re-subscribes when the
 * socket goes quiet, which is how reconnection is handled on top of viem's own socket reconnect.
 */
export function createWaker(cfg: Config): Waker {
  let waiters: Array<() => void> = [];
  const fire = () => {
    const w = waiters;
    waiters = [];
    for (const f of w) f();
  };

  let unwatch: (() => void) | null = null;
  let lastSeen = Date.now();
  let watchdog: NodeJS.Timeout | null = null;
  let closed = false;

  function subscribe() {
    if (!cfg.wsUrl || closed) return;
    try {
      const ws = createPublicClient({
        chain: createChain(cfg),
        transport: webSocket(cfg.wsUrl, { reconnect: { attempts: 10, delay: 1000 }, keepAlive: { interval: 10_000 }, retryCount: 3 }),
      });
      unwatch = ws.watchBlockNumber({
        emitOnBegin: false,
        onBlockNumber: () => {
          lastSeen = Date.now();
          fire();
        },
        onError: (e) => log.warn("ws block subscription error", { err: String(e) }),
      });
    } catch (e) {
      log.warn("ws subscribe failed, relying on polling", { err: String(e) });
    }
  }

  if (cfg.wsUrl) {
    subscribe();
    watchdog = setInterval(() => {
      if (Date.now() - lastSeen > 30_000) {
        log.warn("ws silent for 30s, resubscribing");
        unwatch?.();
        unwatch = null;
        lastSeen = Date.now();
        subscribe();
      }
    }, 10_000);
    watchdog.unref();
  }

  return {
    wake: () =>
      new Promise<void>((resolve) => {
        const t = setTimeout(done, cfg.pollMs);
        function done() {
          clearTimeout(t);
          resolve();
        }
        waiters.push(done);
      }),
    close() {
      closed = true;
      unwatch?.();
      if (watchdog) clearInterval(watchdog);
      fire();
    },
  };
}
