"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { parseMode, parseTab, withState, type SwapTab, type TradeMode } from "@/lib/routes";
import { useUnread } from "./UnreadContext";

export type HubTab = SwapTab;
/** direct = one named collector can accept; open = a public trade anyone can accept. */
export type OfferMode = TradeMode;

interface HubState {
  tab: HubTab;
  setTab: (t: HubTab) => void;
  mode: OfferMode;
  setMode: (m: OfferMode) => void;
  /** Open the New Swap view, optionally choosing Direct or Public Open Trade (used by the Public Trades call to action). */
  startSwap: (mode?: OfferMode) => void;
  /** Open the Incoming Requests view. */
  openRequests: () => void;
}

const Ctx = createContext<HubState | null>(null);

/**
 * The workspace's view state lives in the URL (`/launchpad?tab=requests&mode=open`), so every link, reload and shared URL lands on
 * the same view. Updates use `history.replaceState`, which Next.js feeds back into `useSearchParams`: instant, no server
 * round trip, and no history entry per click.
 */
export function HubProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"));
  const mode = parseMode(params.get("mode"));

  const update = useCallback(
    (next: { tab?: HubTab; mode?: OfferMode }) => {
      const q = withState(window.location.search, next);
      window.history.replaceState(null, "", q ? `${pathname}?${q}` : pathname);
    },
    [pathname],
  );

  // The unread badge clears while the Requests view is on screen.
  const { setViewingRequests } = useUnread();
  useEffect(() => {
    setViewingRequests(tab === "requests");
    return () => setViewingRequests(false);
  }, [tab, setViewingRequests]);

  const value = useMemo<HubState>(
    () => ({
      tab,
      setTab: (t) => update({ tab: t }),
      mode,
      setMode: (m) => update({ mode: m }),
      startSwap: (m) => update({ tab: "new", ...(m ? { mode: m } : {}) }),
      openRequests: () => update({ tab: "requests" }),
    }),
    [tab, mode, update],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHub(): HubState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHub must be used inside <HubProvider>");
  return v;
}
