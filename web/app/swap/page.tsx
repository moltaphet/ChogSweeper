import type { Metadata } from "next";
import { Suspense } from "react";
import { SwapWorkspace } from "@/components/swap/SwapWorkspace";

export const metadata: Metadata = {
  title: "Swap Hub",
  description: "Build, send and accept peer-to-peer NFT swaps on Monad with atomic on-chain settlement.",
};

/** The trading app. `useSearchParams` (the open view) needs a Suspense boundary so the shell can still be prerendered. */
export default function SwapPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 pt-10"><div className="h-[28rem] animate-pulse rounded-[28px] border border-[#DDD6FE] bg-white/60" aria-busy="true" aria-label="Loading the Swap Hub" /></div>}>
      <SwapWorkspace />
    </Suspense>
  );
}
