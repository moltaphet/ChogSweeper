import { TriangleAlert } from "lucide-react";
import { AtomicIcon, BundleIcon, TargetIcon } from "./StepIcons";

const STEPS = [
  { icon: BundleIcon, title: "Assemble Your Bundle", body: "Pick up to 10 verified NFTs from your wallet and add an optional MON sweetener." },
  { icon: TargetIcon, title: "Set Your Terms", body: "Target a specific wallet, or post a public trade and ask for exact tokens from any verified Monad collection." },
  { icon: AtomicIcon, title: "Atomic Settlement", body: "Once accepted, both sides swap in a single atomic transaction. No tokens left stuck in escrow." },
] as const;

const FAQ = [
  { q: "What if nobody accepts my offer?", a: "Nothing happens to your assets. Offers expire at the time you choose, and you can cancel and withdraw at any moment before someone accepts." },
  { q: "Is there a fee?", a: "The person who creates the swap pays a small flat fee in MON. It is refunded in full if the offer is cancelled or declined, and kept only when the trade is accepted. The accepting side never pays a fee. Holders of the Chog collection pay nothing, partner holders get a discount, and the exact amount is shown before you confirm." },
  { q: "What does \u201catomic\u201d mean here?", a: "Every NFT and every MON amount on both sides moves in one transaction. If any part fails, the whole thing reverts and nothing moves." },
  { q: "Which collections can I trade?", a: "Only collections on the verified list, which the contract itself enforces on both sides of every trade. That keeps look-alike and fake collections out. You can look up any token before you trade it." },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20">
      <div className="mb-10 max-w-2xl">
        <p className="eyebrow">How it works</p>
        <h2 id="how-title" className="h-section mt-1">How ChogSweeper works</h2>
        <p className="mt-3 text-monad-muted">Three steps, one transaction. No order books, no slippage, no waiting for a counterparty to show up with the other half.</p>
      </div>

      <ol className="relative grid gap-5 md:grid-cols-3">
        {/* A dashed thread through the cards on wide screens: the order is real, so the line says so. */}
        <div className="pointer-events-none absolute left-[16%] right-[16%] top-[3.4rem] hidden border-t-2 border-dashed border-monad-border md:block" aria-hidden />
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="group relative rounded-3xl border border-[#DDD6FE] bg-gradient-to-br from-monad-tint via-[#F7F5FE] to-white p-6 shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-lift">
            <div className="mb-5 flex items-start justify-between">
              <span className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl border border-white bg-white shadow-[0_10px_24px_-12px_rgba(94,67,243,0.5)] transition duration-300 group-hover:scale-105 group-hover:-rotate-3">
                <Icon />
              </span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet font-display text-sm font-extrabold text-white shadow-[0_6px_14px_-6px_rgba(94,67,243,0.8)]">
                {i + 1}
                <span className="sr-only"> of 3</span>
              </span>
            </div>
            <h3 className="font-display text-xl font-bold">{title}</h3>
            <p className="mt-2 leading-relaxed text-monad-muted">{body}</p>
          </li>
        ))}
      </ol>

      <div className="mx-auto mt-14 max-w-3xl">
        <h3 className="font-display text-2xl font-extrabold tracking-tight">Common questions</h3>
        <div className="mt-5 divide-y divide-monad-border/70 rounded-2xl border border-monad-border bg-white/80 shadow-card backdrop-blur">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                {q}
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-monad-tint text-monad-deep transition group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <p className="mt-3 text-sm text-monad-muted">{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-4 flex items-start gap-2.5 rounded-2xl bg-status-warnBg px-4 py-3 text-sm text-status-warn">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span><strong>Testnet software, not yet audited.</strong> Use test assets only.</span>
        </p>
      </div>
    </section>
  );
}
