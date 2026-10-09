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
      <span className="inline-flex items-center gap-2 text-monad-muted/70" title={soon ? "Link coming soon" : undefined}>
        {children}
        {soon && <span className="rounded-full bg-monad-tint px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-monad-deep">Soon</span>}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-monad-muted transition hover:text-monad-deep">
      {children} <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  );
}

export function Footer() {
  const { data, isError } = useSiteStatus();
  const level = data ? LEVEL[data.level] : null;

  return (
    <footer className="border-t border-monad-border/80 bg-gradient-to-b from-white/60 to-monad-tint/70">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_0.8fr_0.9fr_1.2fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-monad-muted">
            ChogSweeper is a peer-to-peer NFT trading protocol built for the Monad ecosystem. Bundle NFTs, balance deals with MON, and settle everything in one atomic transaction.
          </p>
        </div>

        <nav aria-label="Product">
          <h2 className="label mb-3">Product</h2>
          <ul className="space-y-2 text-sm">
            {FOOTER_NAV.map((n) => (
              <li key={n.label}>
                <Link href={n.href} className="text-monad-muted transition hover:text-monad-deep">{n.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Community">
          <h2 className="label mb-3">Community</h2>
          <ul className="space-y-2 text-sm">
            <li><Ext href={LINKS.chogDiscord} soon>Chog Discord</Ext></li>
            <li><Ext href={LINKS.chogX} soon>Chog on X</Ext></li>
            <li><Ext href={LINKS.monad}>Monad</Ext></li>
            <li><Ext href={LINKS.monadDocs}>Monad docs</Ext></li>
          </ul>
        </nav>

        <nav aria-label="Protocol">
          <h2 className="label mb-3">Protocol</h2>
          <ul className="space-y-2 text-sm">
            <li>{LINKS.contract ? <Ext href={LINKS.contract}>Contract on Testnet Explorer</Ext> : <Ext href={null}>Contract: not deployed yet</Ext>}</li>
            <li><Ext href={LINKS.explorer}>{monadTestnet.blockExplorers.default.name}</Ext></li>
            <li><Ext href={LINKS.github} soon>GitHub repository</Ext></li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-monad-border/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 text-xs text-monad-muted sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-semibold text-monad-ink">ChogSweeper Protocol <span aria-hidden>•</span> Powered by Monad EVM <span aria-hidden>•</span> Built for the Community</p>
            <p>© {new Date().getFullYear()} ChogSweeper. Unaudited testnet software. Not financial advice.</p>
          </div>
          <p role="status" className="inline-flex items-center gap-2 font-medium text-monad-ink">
            <span className="relative flex h-2 w-2" aria-hidden>
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
