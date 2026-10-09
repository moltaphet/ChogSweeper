"use client";

import { ArrowRight, BookOpen } from "lucide-react";
import Link from "next/link";
import { SWAP_PATH } from "@/lib/routes";
import { LiveDot, useLiveLook } from "../site/LiveDot";
import { HeroArt } from "./HeroArt";

/** The three promises under the headline. Emoji are decoration; the words carry the meaning. */
const CHIPS = [
  { icon: "⚡", text: "Sub-second Monad Finality" },
  { icon: "🛡️", text: "Zero Counterparty Risk (Atomic Escrow)" },
  { icon: "💰", text: "Verified Ecosystem Collections & Chog Zero-Fee Trading" },
] as const;

/** "Live on Monad Testnet": its dot reflects the measured network state, so the badge is only green when it is true. */
function LiveBadge() {
  const look = useLiveLook();
  return (
    <p className="pill mb-6" title={look?.text ?? "Checking network status…"}>
      <LiveDot /> Live on Monad Testnet
      <span className="sr-only">{look ? `: ${look.text}` : ": checking status"}</span>
    </p>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative mx-auto max-w-6xl px-4 pb-16 pt-10 sm:pt-16 lg:pb-24">
      <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="animate-fade-up">
          <LiveBadge />
          <h1 id="hero-title" className="font-display text-[2.75rem] font-extrabold leading-[1] tracking-[-0.035em] sm:text-6xl lg:text-[4.35rem]">
            <span className="text-gradient">The Native P2P NFT Trading Protocol </span>
            <span className="relative inline-block whitespace-nowrap">
              <span className="text-gradient">on Monad</span>
              <svg className="absolute -bottom-1.5 left-0 h-3 w-full text-[#8B5CF6]/70" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden>
                <path d="M2 8c30-7 60-7 96-3s64 3 100-2" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
            </span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-monad-muted">
            Trade Chog-to-Chog, swap across collections, or sweeten the deal with native MON. 100% peer-to-peer with trustless atomic on-chain settlement.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={SWAP_PATH} className="btn-primary !px-7 !py-4 text-base">
              Launch App <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            {/* A plain in-page anchor: the browser scrolls smoothly (html has scroll-behavior: smooth) and the URL stays shareable. */}
            <a href="#how-it-works" className="btn-ghost !px-6 !py-4 text-base">
              <BookOpen className="h-4 w-4" aria-hidden /> Explore Docs
            </a>
          </div>

          <ul className="mt-9 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap" aria-label="Highlights">
            {CHIPS.map((c) => (
              <li key={c.text} className="group flex items-center gap-2.5 rounded-2xl border border-monad-border bg-white/75 px-3.5 py-2.5 text-[13px] font-semibold text-monad-ink shadow-card backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:border-monad-primary hover:shadow-lift">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-monad-tint text-base transition group-hover:scale-110" aria-hidden>{c.icon}</span>
                {c.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="animate-fade-up [animation-delay:120ms]">
          <HeroArt />
        </div>
      </div>
    </section>
  );
}
