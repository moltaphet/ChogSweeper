/**
 * Route and URL-state helpers. The landing page lives at `/`, the Launchpad (every tool of the app) at `/launchpad`. Which
 * Launchpad view is open (and whether a new trade is Direct or Public) is URL state, so links like `/launchpad?tab=requests`
 * work from anywhere and a page reload or a shared link lands on the same view. `/swap` is kept as a redirect to it.
 */
export type SwapTab = "overview" | "new" | "requests" | "history" | "public" | "collections" | "activity" | "lookup" | "faucet";
export type TradeMode = "direct" | "open";

export const LAUNCHPAD_PATH = "/launchpad";
/** @deprecated the old name of the app route; use LAUNCHPAD_PATH. */
export const SWAP_PATH = LAUNCHPAD_PATH;
export const HOW_IT_WORKS_HREF = "/#how-it-works";

export const TABS: readonly SwapTab[] = ["overview", "new", "requests", "history", "public", "collections", "activity", "lookup", "faucet"];

/** Unknown, missing or tampered values fall back to the default view; the URL never breaks the page. */
export const parseTab = (v: string | null | undefined): SwapTab => (TABS.includes(v as SwapTab) ? (v as SwapTab) : "overview");
export const parseMode = (v: string | null | undefined): TradeMode => (v === "open" ? "open" : "direct");

/** `/launchpad`, `/launchpad?tab=requests`, `/launchpad?tab=new&mode=open`: defaults are omitted so the common URLs stay clean. */
export function launchpadHref(tab: SwapTab = "overview", mode: TradeMode = "direct"): string {
  const p = new URLSearchParams();
  if (tab !== "overview") p.set("tab", tab);
  if (mode === "open") p.set("mode", "open");
  const q = p.toString();
  return q ? `${LAUNCHPAD_PATH}?${q}` : LAUNCHPAD_PATH;
}

/** Same as `launchpadHref`; kept so older call sites keep working. */
export const swapHref = launchpadHref;

/** Returns `search` (without a leading "?") with `tab`/`mode` updated, preserving every other parameter. */
export function withState(search: string, next: { tab?: SwapTab; mode?: TradeMode }): string {
  const p = new URLSearchParams(search.replace(/^\?/, ""));
  if (next.tab !== undefined) next.tab === "overview" ? p.delete("tab") : p.set("tab", next.tab);
  if (next.mode !== undefined) next.mode === "direct" ? p.delete("mode") : p.set("mode", next.mode);
  return p.toString();
}
