import { Layers, LockKeyhole, Target, Zap } from "lucide-react";

const REASONS = [
  {
    icon: Zap, tint: "from-[#F59E0B] to-[#EF4444]",
    title: "Speed on Monad",
    body: "Trades confirm in about a second on Monad's fast blocks, so an offer is accepted and settled while both collectors are still online.",
  },
  {
    icon: Target, tint: "from-[#EC4899] to-[#8B5CF6]",
    title: "Zero slippage",
    body: "There is no pool and no price curve. You name the exact tokens and MON on each side, and that is exactly what changes hands.",
  },
  {
    icon: LockKeyhole, tint: "from-[#10B981] to-[#0EA5E9]",
    title: "Atomic, non-custodial escrow",
    body: "Your NFTs sit in the contract only until the trade settles or you cancel. Terms can't be edited after posting, and the owner can change fee settings only, never move escrowed items.",
  },
  {
    icon: Layers, tint: "from-[#836EF9] to-[#5E43F3]",
    title: "Multi-asset bundles",
    body: "Put up to 10 NFTs and an amount of MON on each side of one trade, across any ERC-721 collection on Monad.",
  },
] as const;

export function WhySection() {
  return (
    <section id="why" aria-labelledby="why-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20">
      <div className="mb-10 max-w-2xl">
        <p className="eyebrow">Why ChogSweeper</p>
        <h2 id="why-title" className="h-section mt-1">Built for collectors who trade NFTs for NFTs</h2>
        <p className="mt-3 text-monad-muted">Marketplaces make you sell, then buy. ChogSweeper lets two collectors swap directly, with the contract as the only middleman.</p>
      </div>

      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {REASONS.map(({ icon: Icon, tint, title, body }) => (
          <li key={title} className="group rounded-3xl border border-monad-border bg-white/80 p-6 shadow-card backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-monad-primary/50 hover:shadow-lift">
            <span className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${tint} text-white shadow-[0_12px_24px_-10px_rgba(94,67,243,0.7)] transition group-hover:scale-105`}>
              <Icon className="h-6 w-6" aria-hidden />
            </span>
            <h3 className="font-display text-lg font-bold">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-monad-muted">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
