"use client";

import { ExternalLink } from "lucide-react";
import { monadTestnet } from "@/lib/config";
import { useSiteStatus } from "@/lib/hooks-site";
import Link from "next/link";
import { FOOTER_NAV, LINKS } from "@/lib/site";
import { Wordmark } from "./Logo";

const LEVEL = {
  operational: { dot: "bg-status-active", ring: true },
  degraded: { dot: "bg-[#F59E0B]", ring: false },
  outage: { dot: "bg-status-danger", ring: false },
} as const;

/** An outbound link, or (when its URL is not configured) a clearly-labelled placeholder that never pretends to be a link. */
function Ext({ href, children, soon }: { href: string | null; children: React.ReactNode; soon?: boolean }) {
  if (!href) {
    return (
      <span className="inline-flex min-h-7 items-center gap-2 text-monad-muted/80" title={soon ? "Link coming soon" : undefined}>
        {children}
        {soon && <span className="shrink-0 rounded-full border border-monad-border/70 bg-monad-tint/60 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider leading-4 text-monad-deep">Soon</span>}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-7 items-center gap-1.5 text-monad-muted transition-colors hover:text-monad-deep">
      {children} <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
    </a>
  );
}

export function Footer() {
  const { data, isError } = useSiteStatus();
  const level = data ? LEVEL[data.level] : null;

  return (
    <footer className="border-t border-monad-primary/20 dark:border-monad-border/50 dark:bg-monad-bg dark:bg-gradient-to-br dark:from-monad-bg dark:via-monad-bg dark:to-monad-tint/50">
      <div className="mx-auto grid max-w-6xl gap-x-10 gap-y-10 px-4 py-12 sm:grid-cols-2 sm:py-14 lg:grid-cols-[1.35fr_0.7fr_0.85fr_1.1fr] lg:gap-x-12 lg:py-16">
        <div className="min-w-0">
          <Wordmark />
          <p className="mt-5 max-w-xs text-sm leading-7 text-monad-muted">
            ChogSweeper is a peer-to-peer NFT trading protocol built for the Monad ecosystem. Bundle NFTs, balance deals with MON, and settle everything in one atomic transaction.
          </p>
        </div>

        <nav aria-label="Product">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-monad-ink">Product</h2>
          <ul className="space-y-2 text-sm leading-6">
            {FOOTER_NAV.map((n) => (
              <li key={n.label}>
                <Link href={n.href} className="inline-flex min-h-7 items-center text-monad-muted transition-colors hover:text-monad-deep">{n.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Community">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-monad-ink">Community</h2>
          <ul className="space-y-2 text-sm leading-6">
            <li><Ext href={LINKS.chogDiscord} soon>Chog Discord</Ext></li>
            <li><Ext href={LINKS.chogX} soon>Chog on X</Ext></li>
            <li><Ext href={LINKS.monad}>Monad</Ext></li>
            <li><Ext href={LINKS.monadDocs}>Monad docs</Ext></li>
          </ul>
        </nav>

        <nav aria-label="Protocol">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-monad-ink">Protocol</h2>
          <ul className="space-y-2 text-sm leading-6">
            <li>{LINKS.contract ? <Ext href={LINKS.contract}>Contract on Testnet Explorer</Ext> : <Ext href={null}>Contract: not deployed yet</Ext>}</li>
            <li><Ext href={LINKS.explorer}>{monadTestnet.blockExplorers.default.name}</Ext></li>
            <li><Ext href={LINKS.github} soon>GitHub repository</Ext></li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-monad-primary/15 dark:border-monad-border/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 text-xs leading-6 text-monad-muted lg:flex-row lg:items-center lg:justify-between lg:gap-8">
          <div className="min-w-0 space-y-1">
            <p className="font-semibold text-monad-ink">ChogSweeper Protocol <span aria-hidden>•</span> Powered by Monad EVM <span aria-hidden>•</span> Built for the Community</p>
            <p>© {new Date().getFullYear()} ChogSweeper. Unaudited testnet software. Not financial advice.</p>
          </div>
          <p role="status" className="inline-flex items-center gap-2.5 font-medium text-monad-muted">
            <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
              {level?.ring && <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${level ? level.dot : "bg-monad-border"}`} />
            </span>
            {data ? data.message : isError ? "Status unavailable" : "Checking status…"}
          </p>
        </div>
      </div>
    </footer>
  );
}
