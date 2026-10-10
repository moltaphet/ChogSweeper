import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { TOOLS } from "@/lib/launchpad";
import { LAUNCHPAD_PATH, launchpadHref } from "@/lib/routes";

/** What is inside the Launchpad: one card per tool, each linking straight to its view. */
export function ToolsSection() {
  return (
    <section id="tools" aria-labelledby="tools-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="eyebrow">The Launchpad</p>
          <h2 id="tools-title" className="h-section mt-1">Every tool in one place</h2>
          <p className="mt-3 text-monad-muted">Open the Launchpad and everything you need to trade is a tab away: building swaps, handling offers, browsing the open market and vetting collections.</p>
        </div>
        <Link href={LAUNCHPAD_PATH} className="btn-primary">
          Open Launchpad <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOOLS.map(({ tab, label, blurb, icon: Icon }) => (
          <li key={tab}>
            <Link
              href={launchpadHref(tab)}
              className="group flex h-full flex-col rounded-3xl border border-monad-border bg-white/80 p-5 shadow-card backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-monad-primary/50 hover:shadow-lift"
            >
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-violet text-white shadow-[0_8px_16px_-8px_rgba(94,67,243,0.8)] transition group-hover:scale-105">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="font-display text-base font-bold">{label}</h3>
              <p className="mt-1.5 flex-1 text-sm leading-relaxed text-monad-muted">{blurb}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-monad-deep">
                Open <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
        <li>
          <Link
            href={LAUNCHPAD_PATH}
            className="group flex h-full flex-col justify-between rounded-3xl bg-violet p-5 text-white shadow-[0_14px_30px_-14px_rgba(94,67,243,0.8)] transition duration-300 hover:-translate-y-1"
          >
            <span>
              <h3 className="font-display text-lg font-bold">Ready to trade?</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/85">Connect a wallet on Monad Testnet and make your first swap.</p>
            </span>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
              Open Launchpad <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
