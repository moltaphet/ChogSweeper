"use client";

import { useSiteStatus } from "@/lib/hooks-site";
import { LiveDot } from "./LiveDot";

/** The workspace's footer: one quiet line. The full footer belongs to the landing page. */
export function AppFooter() {
  const { data, isError } = useSiteStatus();
  return (
    <footer className="mx-auto mt-10 flex max-w-6xl flex-col gap-2 border-t border-monad-border/70 px-4 py-5 text-xs text-monad-muted sm:flex-row sm:items-center sm:justify-between">
      <p>
        <span className="font-semibold text-monad-ink">ChogSweeper Protocol</span> • Powered by Monad EVM • Built for the Community. Unaudited testnet software.
      </p>
      <p role="status" className="inline-flex items-center gap-2 font-medium text-monad-ink">
        <LiveDot /> {data ? data.message : isError ? "Status unavailable" : "Checking status…"}
      </p>
    </footer>
  );
}
