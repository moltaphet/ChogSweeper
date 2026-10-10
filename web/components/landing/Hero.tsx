"use client";

import { ArrowRight, BookOpen, ShieldCheck, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { LAUNCHPAD_PATH } from "@/lib/routes";
import { LiveDot, useLiveLook } from "../site/LiveDot";
import { HeroScene } from "./HeroStage";

const CHIPS = [
  { icon: Zap, text: "Sub-second Monad finality" },
  { icon: ShieldCheck, text: "Atomic escrow, zero counterparty risk" },
  { icon: Sparkles, text: "Chog holders trade fee-free" },
] as const;

/** "Live on Monad Testnet": its dot reflects the measured network state, so the badge is only green when it is true. */
function LiveBadge() {
  const look = useLiveLook();
  return (
    <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/90 backdrop-blur" title={look?.text ?? "Checking network status…"}>
      <LiveDot /> Live on Monad Testnet
      <span className="sr-only">{look ? `: ${look.text}` : ": checking status"}</span>
    </p>
  );
}

/** A subtle film grain so the dark gradients never band, even on a 4K display. */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative mx-auto max-w-[1320px] px-3 pb-16 pt-4 sm:px-6 sm:pt-6 lg:pb-24">
      <div className="relative isolate overflow-hidden rounded-[32px] bg-[#0C0724] shadow-[0_40px_120px_-30px_rgba(60,30,200,0.65)] ring-1 ring-white/10 sm:rounded-[44px]">
        {/* aurora */}
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div className="absolute -left-[10%] -top-[30%] h-[80%] w-[60%] animate-aurora rounded-full bg-[radial-gradient(closest-side,rgba(124,92,255,0.75),transparent)] blur-3xl" />
          <div className="absolute -right-[10%] top-[5%] h-[70%] w-[55%] animate-aurora rounded-full bg-[radial-gradient(closest-side,rgba(236,72,153,0.5),transparent)] blur-3xl [animation-delay:-5s]" />
          <div className="absolute bottom-[-30%] left-[25%] h-[70%] w-[55%] animate-aurora rounded-full bg-[radial-gradient(closest-side,rgba(56,189,248,0.38),transparent)] blur-3xl [animation-delay:-10s]" />
          {/* perspective grid floor */}
          <div
            className="absolute inset-x-[-20%] bottom-0 h-[55%] opacity-50 [mask-image:linear-gradient(to_top,#000,transparent)]"
            style={{ transform: "perspective(700px) rotateX(62deg)", transformOrigin: "bottom", backgroundImage: "linear-gradient(rgba(167,139,250,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(167,139,250,0.55) 1px, transparent 1px)", backgroundSize: "64px 64px" }}
          />
          <div className="absolute inset-0 opacity-[0.07] mix-blend-screen" style={{ backgroundImage: GRAIN }} />
          <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,transparent_40%,rgba(8,4,28,0.55))]" />
        </div>

        <div className="grid items-center gap-6 px-5 pb-10 pt-12 sm:px-10 sm:pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:gap-4 lg:px-14 lg:pb-14 lg:pt-20">
          <div className="animate-fade-up">
            <LiveBadge />
            <h1 id="hero-title" className="font-display text-[2.6rem] font-extrabold leading-[0.98] tracking-[-0.035em] text-white sm:text-6xl lg:text-[4.2rem]">
              The native P2P NFT trading protocol{" "}
              <span className="relative inline-block whitespace-nowrap">
                <span className="bg-gradient-to-r from-[#C4B5FD] via-[#F0ABFC] to-[#7DD3FC] bg-clip-text text-transparent">on Monad</span>
                <svg className="absolute -bottom-2 left-0 h-3 w-full text-[#C4B5FD]/80" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden>
                  <path d="M2 8c30-7 60-7 96-3s64 3 100-2" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-white/70">
              Trade Chog-to-Chog, swap across collections, or sweeten the deal with native MON. 100% peer-to-peer with trustless atomic on-chain settlement.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={LAUNCHPAD_PATH} className="group inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-4 text-base font-bold text-[#3A1FB8] shadow-[0_18px_40px_-12px_rgba(167,139,250,0.9)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_48px_-12px_rgba(196,181,253,1)]">
                Open Launchpad <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
              </Link>
              <a href="#how-it-works" className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-6 py-4 text-base font-semibold text-white backdrop-blur transition duration-200 hover:border-white/40 hover:bg-white/15">
                <BookOpen className="h-4 w-4" aria-hidden /> How it works
              </a>
            </div>

            <ul className="mt-9 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap" aria-label="Highlights">
              {CHIPS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2.5 rounded-2xl border border-white/12 bg-white/[0.07] px-3.5 py-2.5 text-[13px] font-semibold text-white/90 backdrop-blur">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white/12 text-[#DDD6FE]"><Icon className="h-4 w-4" aria-hidden /></span>
                  {text}
                </li>
              ))}
            </ul>
          </div>

          <div className="animate-fade-up [animation-delay:120ms]">
            <HeroScene />
          </div>
        </div>
      </div>
    </section>
  );
}
