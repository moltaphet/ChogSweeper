"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, type LucideIcon } from "lucide-react";
import { useAccount } from "wagmi";
import { useTrades } from "@/lib/hooks";
import type { SwapRecord } from "@/lib/types";
import { TradeDetailModal } from "./TradeDetailModal";
import { TradeList } from "./TradeList";

export function RequestsPanel() {
  const { address, isConnected } = useAccount();
  const { data, isLoading } = useTrades(address);
  const [openId, setOpenId] = useState<bigint | null>(null);

  const all = [...(data?.incoming ?? []), ...(data?.outgoing ?? []), ...(data?.history ?? [])];
  // Resolve from live data so the modal updates (status, countdown) after an action completes.
  const open: SwapRecord | null = openId === null ? null : (all.find((t) => t.id === openId) ?? null);
  const loading = isConnected && isLoading;
  const expiredCount = (data?.outgoing ?? []).filter((t) => t.status === "expired").length;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Column
          title="Incoming Offers"
          icon={ArrowDownToLine}
          count={data?.incoming.length ?? 0}
          hint="Offers sent to you"
        >
          <TradeList
            trades={data?.incoming ?? []}
            loading={loading}
            onOpen={(t) => setOpenId(t.id)}
            emptyMessage={isConnected ? "No offers are waiting for you." : "Connect your wallet to see offers sent to you."}
          />
        </Column>

        <Column
          title="Outgoing Offers"
          icon={ArrowUpFromLine}
          count={data?.outgoing.length ?? 0}
          hint="Offers you created"
        >
          <TradeList
            trades={data?.outgoing ?? []}
            loading={loading}
            onOpen={(t) => setOpenId(t.id)}
            emptyMessage={isConnected ? "You have no open offers." : "Connect your wallet to see your offers."}
          />
        </Column>
      </div>

      {expiredCount > 0 && (
        <p role="status" className="mt-4 rounded-xl bg-status-warnBg px-4 py-3 text-sm text-status-warn">
          {expiredCount} of your offers expired. Their assets stay in escrow until you reclaim them: open each one under
          Outgoing Offers and press &ldquo;Reclaim assets&rdquo;.
        </p>
      )}

      {data?.source === "chain" && (
        <p className="mt-4 text-xs text-monad-muted">
          Indexer unavailable: showing data read directly from the chain (no collection names or images).
        </p>
      )}
      <TradeDetailModal trade={open} onClose={() => setOpenId(null)} />
    </>
  );
}

function Column(props: { title: string; hint: string; icon: LucideIcon; count: number; children: React.ReactNode }) {
  const Icon = props.icon;
  return (
    <section aria-label={props.title} className="space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-monad-tint text-monad-deep">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-bold leading-tight">{props.title}</h2>
            <p className="text-xs text-monad-muted">{props.hint}</p>
          </div>
        </div>
        <span className="rounded-full bg-monad-primary px-2.5 py-1 text-xs font-bold text-white" aria-label={`${props.count} offers`}>
          {props.count}
        </span>
      </header>
      {props.children}
    </section>
  );
}
