"use client";

import { ArrowUpRight, BookOpen, ExternalLink, Plus } from "lucide-react";
import Link from "next/link";
import { formatMon } from "@/lib/format";
import { useSiteStatus, useStats } from "@/lib/hooks-site";
import { TOOLS } from "@/lib/launchpad";
import { HOW_IT_WORKS_HREF } from "@/lib/routes";
import { LINKS } from "@/lib/site";
import { useHub } from "../HubContext";
import { useUnread } from "../UnreadContext";
import { LiveDot } from "../site/LiveDot";

/** The Launchpad's front door: live numbers, the two ways to start a trade, and a card for every other tool. */
export function Overview() {
  const { setTab, startSwap } = useHub();
  const { unread } = useUnread();
  const stats = useStats();
  const status = useSiteStatus();
  const t = stats.data?.totals;

  const tiles = [
    { label: "Trades completed", value: t ? t.completed.toLocaleString() : "–" },
    { label: "Open trades", value: t ? t.open.toLocaleString() : "–" },
    { label: "Collectors", value: t ? t.traders.toLocaleString() : "–" },
    { label: "MON traded", value: t ? `${formatMon(BigInt(t.volumeWei), 2)} MON` : "–" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-monad-ink" role="status">
          <LiveDot /> {status.data ? status.data.message : status.isError ? "Status unavailable" : "Checking status…"}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary !py-2.5" onClick={() => startSwap("direct")}>
            <Plus className="h-4 w-4" aria-hidden /> New swap
          </button>
          <button type="button" className="btn-ghost !py-2.5" onClick={() => startSwap("open")}>
            Post a public trade
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-2xl border border-monad-border bg-white/80 p-4 shadow-card">
            <dt className="text-xs font-medium text-monad-muted">{x.label}</dt>
            <dd className={`mt-1 font-display text-2xl font-extrabold tracking-tight ${stats.isLoading ? "animate-pulse text-monad-border" : "text-monad-ink"}`}>{x.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="tools-title">
        <h2 id="tools-title" className="mb-3 text-sm font-bold">All tools</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map(({ tab, label, blurb, icon: Icon }) => (
            <li key={tab}>
              <button
                type="button"
                onClick={() => setTab(tab)}
                className="group flex h-full w-full items-start gap-4 rounded-2xl border border-monad-border bg-white/80 p-4 text-left shadow-card transition duration-300 hover:-translate-y-0.5 hover:border-monad-primary/50 hover:shadow-lift"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet text-white shadow-[0_8px_16px_-8px_rgba(94,67,243,0.8)] transition group-hover:scale-105">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-display text-base font-bold">
                    {label}
                    {tab === "requests" && unread > 0 && <span className="rounded-full bg-monad-primary px-1.5 text-[11px] font-bold text-white" aria-label={`${unread} unread`}>{unread}</span>}
                    <ArrowUpRight className="ml-auto h-4 w-4 text-monad-muted transition group-hover:text-monad-deep" aria-hidden />
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-monad-muted">{blurb}</span>
                </span>
              </button>
            </li>
          ))}
          <li>
            <a
              href={LINKS.contract ?? LINKS.explorer}
              target="_blank"
              rel="noreferrer"
              className="group flex h-full w-full items-start gap-4 rounded-2xl border border-dashed border-monad-border bg-white/50 p-4 text-left transition duration-300 hover:-translate-y-0.5 hover:border-monad-primary/50"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-monad-tint text-monad-deep">
                <ExternalLink className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-base font-bold">{LINKS.contract ? "Contract explorer" : "Monad explorer"}</span>
                <span className="mt-1 block text-sm leading-relaxed text-monad-muted">
                  {LINKS.contract ? "Read the deployed ChogSweeper contract on-chain." : "The contract is not deployed yet; this opens the Monad Testnet explorer."}
                </span>
              </span>
            </a>
          </li>
        </ul>
      </section>

      <p className="text-sm text-monad-muted">
        New here? <Link href={HOW_IT_WORKS_HREF} className="inline-flex items-center gap-1 font-semibold text-monad-deep hover:underline"><BookOpen className="h-3.5 w-3.5" aria-hidden /> Read how a swap works</Link>
      </p>
    </div>
  );
}
