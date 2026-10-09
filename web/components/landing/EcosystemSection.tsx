"use client";

import { ArrowRight, BadgeCheck, ExternalLink, Sparkles, Store } from "lucide-react";
import Link from "next/link";
import { monadTestnet } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { useVerifiedCollections, type VerifiedCollection } from "@/lib/hooks-site";
import { SWAP_PATH } from "@/lib/routes";
import { ActivitySection } from "../site/ActivitySection";
import { EmptyState } from "../EmptyState";

function hueOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return 245 + (h % 50);
}

/** A generated tile per collection (no artwork is assumed to exist), tinted from its address so each is recognisable. */
function CollectionCard({ c }: { c: VerifiedCollection }) {
  const hue = hueOf(c.address);
  const name = c.name ?? "Unnamed collection";
  return (
    <li className="group flex items-center gap-4 rounded-2xl border border-monad-border bg-white/80 p-4 shadow-card backdrop-blur transition duration-300 hover:-translate-y-0.5 hover:border-monad-primary/50 hover:shadow-lift">
      <span
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl font-display text-2xl font-extrabold text-white"
        style={{ background: `linear-gradient(145deg, hsl(${hue} 80% 68%), hsl(${hue + 18} 72% 52%))` }}
        aria-hidden
      >
        {name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-display text-base font-bold">
          <span className="truncate">{name}</span>
          <BadgeCheck className="h-4 w-4 shrink-0 text-status-active" aria-label="Verified collection" />
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-monad-muted">
          <a href={`${monadTestnet.blockExplorers.default.url}/address/${c.address}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono hover:text-monad-deep">
            {shortAddress(c.address)} <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
          {c.isChog ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              <Sparkles className="h-3 w-3" aria-hidden /> Chog · zero-fee trading
            </span>
          ) : (
            <span className="rounded-full bg-status-activeBg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-status-activeInk">Monad ecosystem</span>
          )}
        </p>
      </div>
    </li>
  );
}

export function EcosystemSection() {
  const { data, isLoading, isError } = useVerifiedCollections();

  return (
    <section id="ecosystem" aria-labelledby="ecosystem-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-24">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="eyebrow">Ecosystem</p>
          <h2 id="ecosystem-title" className="h-section mt-1">Ecosystem &amp; verified collections</h2>
          <p className="mt-3 text-monad-muted">
            Collections in the verified registry carry a badge everywhere in the app. Chog holders trade with no platform fee. Anything not on the list is clearly marked as unverified, but can still be traded.
          </p>
        </div>
        <Link href={SWAP_PATH} className="btn-primary">
          Trade now <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <h3 className="mb-3 text-sm font-bold">Verified collections</h3>
          {isLoading ? (
            <ul className="space-y-3" aria-busy="true" aria-label="Loading collections">
              {[0, 1].map((i) => <li key={i} className="h-[5.5rem] animate-pulse rounded-2xl border border-monad-border bg-white/60" />)}
            </ul>
          ) : isError || !data || data.length === 0 ? (
            <EmptyState icon={Store} compact title={isError ? "The registry is unavailable" : "No verified collections yet"} body="Verified Chog and Monad ecosystem collections will be listed here once the registry is configured." />
          ) : (
            <ul className="space-y-3">{data.map((c) => <CollectionCard key={c.address} c={c} />)}</ul>
          )}
        </div>

        <ActivitySection />
      </div>
    </section>
  );
}
