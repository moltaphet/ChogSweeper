"use client";

import { useSyncExternalStore } from "react";
import { useAccount as useWagmiAccount } from "wagmi";

const noop = () => () => {};

/** False on the server and during hydration, true afterwards. Safe even when a Suspense boundary hydrates late. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * wagmi's `useAccount`, but it reports "no wallet" until the page has hydrated.
 *
 * wagmi restores the saved connection in an effect, which can run BEFORE React hydrates content that sits inside a Suspense
 * boundary. That content would then render "connected" while the server HTML said "not connected", and React throws a
 * hydration error and discards the server render. Masking the first render keeps both sides identical; the real state
 * arrives one render later.
 */
export function useAccount(): ReturnType<typeof useWagmiAccount> {
  const account = useWagmiAccount();
  const hydrated = useHydrated();
  if (hydrated) return account;
  return {
    ...account,
    address: undefined,
    addresses: undefined,
    chain: undefined,
    chainId: undefined,
    connector: undefined,
    isConnected: false,
    isConnecting: false,
    isDisconnected: true,
    isReconnecting: false,
    status: "disconnected",
  } as ReturnType<typeof useWagmiAccount>;
}
