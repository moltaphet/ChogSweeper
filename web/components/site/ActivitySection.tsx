"use client";

import { Activity, ArrowRight, PlugZap } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatMon } from "@/lib/format";
import { useStats, type ActivityItem } from "@/lib/hooks-site";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "../EmptyState";
import { NftImage } from "../NftImage";
import { VerifiedBadge } from "../VerifiedBadge";
import { MonTicker } from "@/components/site/MonTicker";
import { launchpadHref } from "@/lib/routes";

const DOT: Record<ActivityItem["status"], { cls: string; label: string }> = {
  completed: { cls: "bg-status-active", label: "Completed" },
  pending: { cls: "bg-monad-primary", label: "Offered" },
  cancelled: { cls: "bg-status-danger", label: "Cancelled" },
  declined: { cls: "bg-status-danger", label: "Declined" },
  expired: { cls: "bg-status-danger", label: "Expired" },
};

export function ActivitySection() {
  const { data, isError, isLoading } = useStats();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const t = data?.totals;
  const tiles = [
    { label: "Trades completed", value: t ? t.completed.toLocaleString() : "–" },
    { label: "Open trades", value: t ? t.open.toLocaleString() : "–" },
    { label: "Collectors", value: t ? t.traders.toLocaleString() : "–" },
    { label: "MON traded", value: t ? formatMon(BigInt(t.volumeWei), 2) : "–", coin: true },
  ];

  return (
    <section id="activity" aria-labelledby="activity-title" className="scroll-mt-24">
      <div className="mb-5">
        <p className="eyebrow">Indexer-backed stats</p>
        <h2 id="activity-title" className="h-section mt-1">Activity</h2>
        {t && <p className="mt-2 text-sm text-monad-muted">{t.last24h.toLocaleString()} offer{t.last24h === 1 ? "" : "s"} created in the last 24 hours.</p>}
      </div>

      {isError ? (
        <>
          <EmptyState icon={PlugZap} compact title="Activity stats are unavailable" body="The indexer is not responding, so totals and recent history cannot be loaded right now." />
          <Link href={launchpadHref("public")} className="btn-ghost mx-auto mt-3 flex w-fit items-center gap-2">
            Browse open trades <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3">
            {tiles.map((x) => (
              <div key={x.label} className="rounded-2xl border border-monad-border bg-white/80 p-4 shadow-card backdrop-blur">
                <dt className="text-xs font-medium text-monad-muted">{x.label}</dt>
                <dd className={`mt-1 font-display text-2xl font-extrabold tracking-tight ${isLoading ? "animate-pulse text-monad-border" : "text-monad-ink"}`}>
                  {x.value}
                  {x.coin && !isLoading && <MonTicker className="ml-1.5 h-5" />}
                </dd>
              </div>
            ))}
          </dl>

          <h3 className="mb-2 mt-6 text-sm font-bold">Latest</h3>
          {data && data.recent.length === 0 ? (
            <EmptyState icon={Activity} compact title="Nothing has traded yet" body="The first swap will show up here as soon as it's confirmed." />
          ) : (
            <ul className="divide-y divide-monad-border/70 rounded-2xl border border-monad-border bg-white/80 shadow-card backdrop-blur">
              {(data?.recent ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3.5 py-3">
                  <NftImage
                    src={a.first?.image} fallbacks={a.first?.imageFallbacks} alt="" compact
                    collectionName={a.first?.collectionName ?? "NFT"} tokenId={a.first?.tokenId ?? a.id}
                    className="h-10 w-10 shrink-0 rounded-xl"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      Trade #{a.id}
                      {a.first?.verified && <VerifiedBadge verified ecosystem={null} compact />}
                    </p>
                    <p className="truncate text-xs text-monad-muted">
                      {a.assetCount} NFT{a.assetCount === 1 ? "" : "s"}
                      {BigInt(a.monWei) > 0n && <> + <span className="font-semibold text-coin-ink">{formatMon(BigInt(a.monWei), 3)} <MonTicker /></span></>}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="flex items-center justify-end gap-1.5 text-xs font-semibold">
                      <span className={`h-1.5 w-1.5 rounded-full ${DOT[a.status].cls}`} aria-hidden /> {DOT[a.status].label}
                    </p>
                    <p className="text-[11px] text-monad-muted">{timeAgo(a.at, now)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
