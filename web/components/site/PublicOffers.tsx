"use client";

import { Globe, PlugZap, Plus } from "lucide-react";
import { useState } from "react";
import { usePublicOffers } from "@/lib/hooks-site";
import { EmptyState } from "../EmptyState";
import { useHub } from "../HubContext";
import { TradeDetailModal } from "../TradeDetailModal";
import { TradeList } from "../TradeList";

const PAGE = 4;

/** Open Counter offers: anyone can accept, first come first served. */
export function PublicOffers() {
  const { startSwap } = useHub();
  const offers = usePublicOffers();
  const [openId, setOpenId] = useState<bigint | null>(null);
  const [shown, setShown] = useState(PAGE);

  const list = offers.data ?? [];
  const open = openId === null ? null : (list.find((t) => t.id === openId) ?? null);

  return (
    <section id="public" aria-labelledby="public-title" className="scroll-mt-24">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Open market</p>
          <h2 id="public-title" className="h-section mt-1">Public trades</h2>
          <p className="mt-2 max-w-md text-sm text-monad-muted">Trades anyone can accept. The first collector to accept wins, and settlement is atomic.</p>
        </div>
        <button type="button" className="btn-primary !py-2.5" onClick={() => startSwap("open")}>
          <Plus className="h-4 w-4" aria-hidden /> Post a public trade
        </button>
      </div>

      {offers.isError ? (
        <EmptyState icon={PlugZap} title="Public trades are offline" body="They come from the indexer, which isn't reachable right now. Direct swaps still work." />
      ) : offers.isLoading ? (
        <TradeList trades={[]} loading emptyMessage="" onOpen={() => {}} />
      ) : list.length === 0 ? (
        <EmptyState icon={Globe} title="No public trades yet" body="Be the first: post a trade anyone can accept." action={{ label: "Post a public trade", onClick: () => startSwap("open"), icon: Plus }} />
      ) : (
        <>
          <TradeList trades={list.slice(0, shown)} loading={false} emptyMessage="" onOpen={(t) => setOpenId(t.id)} />
          {list.length > shown && (
            <button type="button" className="btn-ghost mx-auto mt-4 flex" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({list.length - shown} more)
            </button>
          )}
        </>
      )}
      <TradeDetailModal trade={open} onClose={() => setOpenId(null)} />
    </section>
  );
}
