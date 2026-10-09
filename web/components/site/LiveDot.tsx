"use client";

import { useSiteStatus } from "@/lib/hooks-site";

const LOOK = {
  operational: { dot: "bg-status-active", ring: "bg-status-active/60", text: "Monad Testnet is live" },
  degraded: { dot: "bg-[#F59E0B]", ring: "bg-[#F59E0B]/50", text: "Monad Testnet: degraded service" },
  outage: { dot: "bg-status-danger", ring: "bg-status-danger/50", text: "Monad Testnet is unreachable" },
} as const;

/** The measured network state, or null while it is unknown (so nothing ever claims "live" without knowing). */
export function useLiveLook() {
  const { data } = useSiteStatus();
  return data ? LOOK[data.level] : null;
}

/** A small pulsing dot: green only while /api/status measures a working RPC and a caught-up indexer, amber/red when not, grey while unknown. */
export function LiveDot({ className = "" }: { className?: string }) {
  const look = useLiveLook();
  return (
    <span className={`relative flex h-2 w-2 ${className}`} aria-hidden>
      {look && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${look.ring}`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${look ? look.dot : "bg-monad-border"}`} />
    </span>
  );
}
