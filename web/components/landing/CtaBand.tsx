import { ArrowRight, Globe } from "lucide-react";
import Link from "next/link";
import { LAUNCHPAD_PATH, launchpadHref } from "@/lib/routes";
import { ChogCard } from "./ChogCard";
import { NftCard } from "./NftCard";

/** The closing call to action: the hero's dark stage again, so the page starts and ends on the same note. */
export function CtaBand() {
  return (
    <section aria-labelledby="cta-title" className="mx-auto max-w-[1320px] px-3 pb-20 sm:px-6">
      <div className="relative isolate overflow-hidden rounded-[32px] bg-[#0C0724] px-6 py-14 text-center shadow-[0_40px_120px_-30px_rgba(60,30,200,0.6)] ring-1 ring-white/10 sm:rounded-[44px] sm:py-20">
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div className="absolute left-1/2 top-[-40%] h-[90%] w-[70%] -translate-x-1/2 animate-aurora rounded-full bg-[radial-gradient(closest-side,rgba(124,92,255,0.7),transparent)] blur-3xl" />
          <div className="absolute bottom-[-40%] right-[5%] h-[70%] w-[45%] animate-aurora rounded-full bg-[radial-gradient(closest-side,rgba(236,72,153,0.45),transparent)] blur-3xl [animation-delay:-6s]" />
        </div>

        <div className="mx-auto mb-8 flex max-w-md items-end justify-center gap-2 sm:gap-3" aria-hidden>
          <NftCard id={21} slot={1} className="w-16 -rotate-6 sm:w-24" />
          <NftCard id={7} slot={2} className="mb-3 w-16 -rotate-3 sm:mb-4 sm:w-24" />
          <ChogCard id={1} slot={0} className="z-10 mb-5 w-20 sm:mb-6 sm:w-28" />
          <NftCard id={42} slot={7} className="w-16 rotate-6 sm:w-24" />
        </div>

        <h2 id="cta-title" className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">Ready to swap your Chogs?</h2>
        <p className="mx-auto mt-4 max-w-lg text-white/70">Connect a wallet on Monad Testnet, bundle your NFTs and settle the whole deal in one transaction.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={LAUNCHPAD_PATH} className="theme-always-white group inline-flex items-center gap-2 rounded-2xl bg-white px-8 py-4 text-base font-bold text-[#3A1FB8] shadow-[0_18px_40px_-12px_rgba(167,139,250,0.9)] transition duration-200 hover:-translate-y-0.5">
            Open Launchpad <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <Link href={launchpadHref("public")} className="inline-flex items-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-7 py-4 text-base font-semibold text-white transition hover:bg-white/15">
            <Globe className="h-4 w-4" aria-hidden /> Browse open trades
          </Link>
        </div>
      </div>
    </section>
  );
}
