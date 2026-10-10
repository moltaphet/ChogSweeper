"use client";

import { useState } from "react";
import { AlertCircle, Check, Loader2, ShieldAlert, X } from "lucide-react";
import { formatMon } from "@/lib/format";
import type { SwapRecord } from "@/lib/types";
import { useTradeActions } from "@/lib/useTradeActions";

/**
 * Accept / Decline / Cancel buttons for a trade, limited to what the connected wallet may do.
 * `onReview` is passed by list rows: trades with unverified collections cannot be accepted from a row, the button opens
 * the detail view instead. In the detail view the taker must tick a confirmation first.
 */
export function TradeActions({ trade, layout = "row", onReview }: { trade: SwapRecord; layout?: "row" | "stack"; onReview?: () => void }) {
  const a = useTradeActions(trade);
  const [reviewed, setReviewed] = useState(false);
  if (!a.hasActions && !a.error) return null;
  const working = a.busy !== null;

  return (
    <div className={layout === "stack" ? "space-y-3" : "space-y-2"}>
      {a.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-status-dangerBg px-3 py-2 text-xs text-status-dangerInk">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {a.error}
        </p>
      )}
      {a.canCancel && a.isExpired && (
        <p className="rounded-lg bg-status-warnBg px-3 py-2 text-xs text-status-warn">
          This offer expired, but your assets are still held in escrow. Reclaim them to get them back.
        </p>
      )}
      {a.requiresReview && !onReview && (
        <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-status-warnBg px-3 py-2 text-xs text-status-warn">
          <input type="checkbox" className="mt-0.5" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
          <span>
            <ShieldAlert className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            I checked the contract addresses of the unverified collections on the explorer. Fake collections can take
            your payment without delivering anything.
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {a.canCancel && (
          <button className="btn-ghost" disabled={working} onClick={a.cancel}>
            {a.busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} {a.isExpired ? "Reclaim assets" : "Cancel offer"}
          </button>
        )}
        {a.canDecline && (
          <button className="btn-ghost" disabled={working} onClick={a.decline}>
            {a.busy === "decline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Decline
          </button>
        )}
        {a.canAccept && a.requiresReview && onReview ? (
          <button className="btn-primary" onClick={onReview}>
            <ShieldAlert className="h-4 w-4" /> Review before accepting
          </button>
        ) : a.canAccept && (
          <button className="btn-primary" disabled={working || (a.requiresReview && !reviewed)} onClick={a.accept}>
            {a.busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Accept{a.totalDue !== null && a.totalDue > 0n ? ` · pay ${formatMon(a.totalDue)} MON` : ""}
          </button>
        )}
      </div>
    </div>
  );
}
