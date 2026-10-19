import type { Metadata } from "next";
import { Suspense } from "react";
import { Launchpad } from "@/components/launchpad/Launchpad";

export const metadata: Metadata = {
  title: "Launchpad",
  description: "Every ChogSweeper tool in one place: build and accept peer-to-peer NFT swaps, browse public trades and check collections on Monad.",
};

/** The app. `useSearchParams` (the open view) needs a Suspense boundary so the shell can still be prerendered. */
export default function LaunchpadPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 pt-10"><div className="h-[28rem] animate-pulse rounded-[28px] border border-monad-border bg-white/60" aria-busy="true" aria-label="Loading the Launchpad" /></div>}>
      <Launchpad />
    </Suspense>
  );
}
