"use client";

import { useState } from "react";
import { useAccount } from "@/lib/useAccount";
import { useTrades } from "@/lib/hooks";
import { TradeDetailModal } from "./TradeDetailModal";
import { TradeList } from "./TradeList";

export function HistoryPanel() {
  const { address, isConnected } = useAccount();
  const { data, isLoading } = useTrades(address);
  const [openId, setOpenId] = useState<bigint | null>(null);
  const history = data?.history ?? [];
  const open = openId === null ? null : (history.find((t) => t.id === openId) ?? null);

  return (
    <>
      <TradeList
        trades={history}
        loading={isConnected && isLoading}
        onOpen={(t) => setOpenId(t.id)}
        emptyMessage={isConnected ? "No completed, cancelled or declined offers yet." : "Connect your wallet to see your history."}
      />
      <TradeDetailModal trade={open} onClose={() => setOpenId(null)} />
    </>
  );
}
