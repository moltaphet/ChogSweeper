"use client";

import { Clock, Globe, Inbox, Plus } from "lucide-react";
import { useEffect } from "react";
import { HistoryPanel } from "../HistoryPanel";
import { HubProvider, useHub, type HubTab } from "../HubContext";
import { RequestsPanel } from "../RequestsPanel";
import { AppFooter } from "../site/AppFooter";
import { PublicOffers } from "../site/PublicOffers";
import { SwapBuilder } from "../SwapBuilder";
import { useUnread } from "../UnreadContext";

const TABS: ReadonlyArray<{ id: HubTab; label: string; icon: typeof Plus }> = [
  { id: "new", label: "New Swap", icon: Plus },
  { id: "requests", label: "Requests", icon: Inbox },
  { id: "history", label: "History", icon: Clock },
  { id: "public", label: "Public Trades", icon: Globe },
];

/** The trading workspace: just the Swap Hub, no marketing around it. The open view is URL state (`/swap?tab=…`). */
export function SwapWorkspace() {
  return (
    <HubProvider>
      <Workspace />
    </HubProvider>
  );
}

function Workspace() {
  const { tab, setTab } = useHub();
  const { unread } = useUnread();

  // On a narrow screen the tab row scrolls sideways; keep the open tab visible (matters for deep links like ?tab=public).
  useEffect(() => {
    document.getElementById(`tab-${tab}`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tab]);

  return (
    <>
      <main id="main" className="relative mx-auto max-w-6xl px-4 pb-6 pt-8 sm:pt-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Trade hub</p>
            <h1 className="h-section mt-1">Swap Hub</h1>
            <p className="mt-2 max-w-md text-sm text-monad-muted">Bundle NFTs and MON, choose who can accept, and settle in one atomic transaction.</p>
          </div>

          <div role="tablist" aria-label="Swap Hub views" className="flex max-w-full overflow-x-auto rounded-2xl border border-monad-border bg-white/80 p-1 shadow-card backdrop-blur">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={active}
                  aria-controls={`panel-${id}`}
                  onClick={() => setTab(id)}
                  className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition duration-200 ${active ? "bg-violet text-white shadow-[0_6px_14px_-6px_rgba(94,67,243,0.7)]" : "text-monad-muted hover:bg-monad-tint hover:text-monad-deep"}`}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                  {id === "requests" && unread > 0 && (
                    <span className={`rounded-full px-1.5 text-[11px] font-bold ${active ? "bg-white text-monad-deep" : "bg-monad-primary text-white"}`} aria-label={`${unread} unread incoming requests`}>
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative">
          {/* The glow is its own layer behind the card, so it never clips the sticky summary bar inside. */}
          <div className="pointer-events-none absolute -inset-x-2 -inset-y-8 -z-10 sm:-inset-x-6 rounded-[48px] bg-[radial-gradient(60%_60%_at_50%_30%,rgba(131,110,249,0.28),transparent_70%)] blur-2xl" aria-hidden />
          <div className="rounded-[28px] border border-[#DDD6FE] bg-white/70 shadow-[0_1px_2px_rgba(94,67,243,0.06),0_24px_60px_-24px_rgba(94,67,243,0.38)] backdrop-blur-xl">
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="relative rounded-[27px]">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-40 rounded-t-[27px] bg-gradient-to-b from-monad-primary/[0.08] to-transparent" aria-hidden />
              <div className="relative">
                {tab === "new" && <SwapBuilder />}
                {tab === "requests" && <div className="p-5 sm:p-7"><RequestsPanel /></div>}
                {tab === "history" && <div className="p-5 sm:p-7"><HistoryPanel /></div>}
                {tab === "public" && <div className="p-5 sm:p-7"><PublicOffers /></div>}
              </div>
            </div>
          </div>
        </div>
      </main>
      <AppFooter />
    </>
  );
}
