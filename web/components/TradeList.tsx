"use client";

import { ArrowLeftRight, Loader2 } from "lucide-react";
import { ZERO_ADDRESS } from "@/lib/config";
import { sameAddress, shortAddress } from "@/lib/format";
import type { SwapRecord } from "@/lib/types";
import { AssetSummaryCard } from "./AssetSummaryCard";
import { StatusBadge } from "./StatusBadge";
import { TradeActions } from "./TradeActions";
import { useAccount } from "wagmi";

interface Props {
  trades: readonly SwapRecord[];
  loading: boolean;
  emptyMessage: string;
  onOpen: (trade: SwapRecord) => void;
}

export function TradeList({ trades, loading, emptyMessage, onOpen }: Props) {
  if (loading) {
    return (
      <div className="card flex h-36 items-center justify-center gap-2 text-sm text-monad-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading offers…
      </div>
    );
  }
  if (trades.length === 0) {
    return <div className="card flex h-36 items-center justify-center px-6 text-center text-sm text-monad-muted">{emptyMessage}</div>;
  }
  return (
    <ul className="space-y-4">
      {trades.map((t) => (
        <TradeRow key={t.id.toString()} trade={t} onOpen={onOpen} />
      ))}
    </ul>
  );
}

function TradeRow({ trade, onOpen }: { trade: SwapRecord; onOpen: (t: SwapRecord) => void }) {
  const { address } = useAccount();
  const isMaker = sameAddress(trade.maker, address);
  const counterparty = isMaker ? (trade.taker === ZERO_ADDRESS ? "anyone" : shortAddress(trade.taker)) : shortAddress(trade.maker);

  return (
    <li className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-sm font-semibold text-monad-deep">#{trade.id.toString()}</span>
          <StatusBadge status={trade.status} />
        </div>
        <p className="text-xs text-monad-muted">
          {isMaker ? "To" : "From"} <span className="font-mono">{counterparty}</span>
        </p>
      </div>

      {/* The whole summary is a button so the card opens the detail view from the keyboard too. */}
      <button
        type="button"
        onClick={() => onOpen(trade)}
        className="block w-full rounded-2xl text-left transition hover:bg-monad-tint/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-monad-primary"
        aria-label={`View details of trade ${trade.id}`}
      >
        <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
          <AssetSummaryCard title={isMaker ? "You give" : "They give"} nfts={trade.offered} monWei={trade.offeredMon} compact />
          <ArrowLeftRight className="mx-auto hidden h-5 w-5 text-monad-primary md:block" aria-hidden />
          <AssetSummaryCard title={isMaker ? "You receive" : "You give"} nfts={trade.wanted} monWei={trade.wantedMon} compact />
        </div>
      </button>

      <div className="mt-3">
        <TradeActions trade={trade} />
      </div>
    </li>
  );
}
