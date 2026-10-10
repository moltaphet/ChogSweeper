"use client";

import { LayoutDashboard } from "lucide-react";
import { useEffect } from "react";
import { TOOLS } from "@/lib/launchpad";
import { HistoryPanel } from "../HistoryPanel";
import { HubProvider, useHub, type HubTab } from "../HubContext";
import { RequestsPanel } from "../RequestsPanel";
import { ActivitySection } from "../site/ActivitySection";
import { AppFooter } from "../site/AppFooter";
import { CollectionList } from "../site/CollectionList";
import { PublicOffers } from "../site/PublicOffers";
import { SwapBuilder } from "../SwapBuilder";
import { useUnread } from "../UnreadContext";
import { Overview } from "./Overview";
import { TokenLookup } from "./TokenLookup";

const TABS = [{ id: "overview" as const, label: "Overview", icon: LayoutDashboard }, ...TOOLS.map((t) => ({ id: t.tab as HubTab, label: t.tabLabel, icon: t.icon }))];

/** The Launchpad: every tool of the app in one workspace. The open view is URL state (`/launchpad?tab=…`). */
export function Launchpad() {
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
        <div className="mb-5">
          <p className="eyebrow">Launchpad</p>
          <h1 className="h-section mt-1">Everything you need to trade</h1>
          <p className="mt-2 max-w-xl text-sm text-monad-muted">Build swaps, manage offers, browse public trades and check collections. One workspace, settled atomically on Monad.</p>
        </div>

        <div role="tablist" aria-label="Launchpad tools" className="mb-5 flex max-w-full overflow-x-auto rounded-2xl border border-monad-border bg-white/80 p-1 shadow-card backdrop-blur">
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

        <div className="relative">
          {/* The glow is its own layer behind the card, so it never clips the sticky summary bar inside. */}
          <div className="pointer-events-none absolute -inset-x-2 -inset-y-8 -z-10 sm:-inset-x-6 rounded-[48px] bg-[radial-gradient(60%_60%_at_50%_30%,rgba(131,110,249,0.28),transparent_70%)] blur-2xl" aria-hidden />
          <div className="rounded-[28px] border border-[#DDD6FE] bg-white/70 shadow-[0_1px_2px_rgba(94,67,243,0.06),0_24px_60px_-24px_rgba(94,67,243,0.38)] backdrop-blur-xl">
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="relative rounded-[27px]">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-40 rounded-t-[27px] bg-gradient-to-b from-monad-primary/[0.08] to-transparent" aria-hidden />
              <div className="relative">
                {tab === "overview" && <div className="p-5 sm:p-7"><Overview /></div>}
                {tab === "new" && <SwapBuilder />}
                {tab === "requests" && <div className="p-5 sm:p-7"><RequestsPanel /></div>}
                {tab === "history" && <div className="p-5 sm:p-7"><HistoryPanel /></div>}
                {tab === "public" && <div className="p-5 sm:p-7"><PublicOffers /></div>}
                {tab === "collections" && (
                  <div className="p-5 sm:p-7">
                    <p className="eyebrow">Registry</p>
                    <h2 className="h-section mt-1">Verified collections</h2>
                    <p className="mb-5 mt-2 max-w-xl text-sm text-monad-muted">Collections in this list carry a badge everywhere in the app. Chog holders trade with no platform fee.</p>
                    <CollectionList />
                  </div>
                )}
                {tab === "activity" && <div className="p-5 sm:p-7"><ActivitySection /></div>}
                {tab === "lookup" && <div className="p-5 sm:p-7"><TokenLookup /></div>}
              </div>
            </div>
          </div>
        </div>
      </main>
      <AppFooter />
    </>
  );
}
