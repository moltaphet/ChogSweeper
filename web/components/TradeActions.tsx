"use client";

import { AlertCircle, Check, Loader2, X } from "lucide-react";
import { formatMon } from "@/lib/format";
import type { SwapRecord } from "@/lib/types";
import { useTradeActions } from "@/lib/useTradeActions";

/** Accept / Decline / Cancel buttons for a trade, limited to what the connected wallet may do. */
export function TradeActions({ trade, layout = "row" }: { trade: SwapRecord; layout?: "row" | "stack" }) {
  const a = useTradeActions(trade);
  if (!a.hasActions && !a.error) return null;
  const working = a.busy !== null;

  return (
    <div className={layout === "stack" ? "space-y-3" : "space-y-2"}>
      {a.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-status-dangerBg px-3 py-2 text-xs text-status-dangerInk">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {a.error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {a.canCancel && (
          <button className="btn-ghost" disabled={working} onClick={a.cancel}>
            {a.busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Cancel offer
          </button>
        )}
        {a.canDecline && (
          <button className="btn-ghost" disabled={working} onClick={a.decline}>
            {a.busy === "decline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Decline
          </button>
        )}
        {a.canAccept && (
          <button className="btn-primary" disabled={working} onClick={a.accept}>
            {a.busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Accept{a.totalDue !== null && a.totalDue > 0n ? ` · pay ${formatMon(a.totalDue)} MON` : ""}
          </button>
        )}
      </div>
    </div>
  );
}
