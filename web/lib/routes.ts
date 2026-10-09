/**
 * Route and URL-state helpers. The landing page lives at `/`, the trading workspace at `/swap`. Which workspace view is open
 * (and whether a new trade is Direct or Public) is URL state, so links like `/swap?tab=requests` work from anywhere and a page
 * reload or a shared link lands on the same view.
 */
export type SwapTab = "new" | "requests" | "history" | "public";
export type TradeMode = "direct" | "open";

export const SWAP_PATH = "/swap";
export const HOW_IT_WORKS_HREF = "/#how-it-works";

const TABS: readonly SwapTab[] = ["new", "requests", "history", "public"];

/** Unknown, missing or tampered values fall back to the default view; the URL never breaks the page. */
export const parseTab = (v: string | null | undefined): SwapTab => (TABS.includes(v as SwapTab) ? (v as SwapTab) : "new");
export const parseMode = (v: string | null | undefined): TradeMode => (v === "open" ? "open" : "direct");

/** `/swap`, `/swap?tab=requests`, `/swap?mode=open`: defaults are omitted so the common URLs stay clean. */
export function swapHref(tab: SwapTab = "new", mode: TradeMode = "direct"): string {
  const p = new URLSearchParams();
  if (tab !== "new") p.set("tab", tab);
  if (mode === "open") p.set("mode", "open");
  const q = p.toString();
  return q ? `${SWAP_PATH}?${q}` : SWAP_PATH;
}

/** Returns `search` (without a leading "?") with `tab`/`mode` updated, preserving every other parameter. */
export function withState(search: string, next: { tab?: SwapTab; mode?: TradeMode }): string {
  const p = new URLSearchParams(search.replace(/^\?/, ""));
  if (next.tab !== undefined) next.tab === "new" ? p.delete("tab") : p.set("tab", next.tab);
  if (next.mode !== undefined) next.mode === "direct" ? p.delete("mode") : p.set("mode", next.mode);
  return p.toString();
}
