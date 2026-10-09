"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { useTrades } from "@/lib/hooks";
import { countUnread, loadSeen, mergeSeen, saveSeen } from "@/lib/unread";

interface UnreadState {
  /** Incoming offers addressed to the connected wallet that it has not looked at in the Requests view. */
  unread: number;
  /** The Requests view calls this while it is on screen: everything listed is then marked as read. */
  setViewingRequests: (viewing: boolean) => void;
}

const Ctx = createContext<UnreadState>({ unread: 0, setViewingRequests: () => {} });

/**
 * Lives at the root so the navbar badge is correct on every route (it is shown on the landing page too), while only the
 * Requests view on `/swap` is allowed to mark things as read.
 */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const incoming = useTrades(address).data?.incoming;
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState(false);

  useEffect(() => setSeen(address ? loadSeen(address) : new Set()), [address]);

  const incomingIds = useMemo(() => (incoming ?? []).map((t) => t.id.toString()), [incoming]);

  // While the Requests view is open, anything that is listed counts as read (including offers that arrive meanwhile).
  useEffect(() => {
    if (!viewing || !address || !incoming) return;
    setSeen((prev) => {
      const next = mergeSeen(prev, incomingIds);
      if (next.size === prev.size) return prev;
      saveSeen(address, next);
      return next;
    });
  }, [viewing, address, incoming, incomingIds]);

  const value = useMemo<UnreadState>(
    () => ({ unread: address ? countUnread(incomingIds, seen) : 0, setViewingRequests: setViewing }),
    [address, incomingIds, seen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useUnread = () => useContext(Ctx);
