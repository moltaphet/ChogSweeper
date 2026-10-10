import { describe, expect, it } from "vitest";
import { HOW_IT_WORKS_HREF, parseMode, parseTab, launchpadHref, TABS, withState } from "../lib/routes";

describe("route helpers", () => {
  it("parses the tab, falling back to the default on anything unexpected", () => {
    expect(parseTab("requests")).toBe("requests");
    expect(parseTab("history")).toBe("history");
    expect(parseTab("public")).toBe("public");
    for (const t of ["new", "collections", "activity", "lookup", "overview"]) expect(parseTab(t)).toBe(t);
    for (const bad of [null, undefined, "", "REQUESTS", "admin", "requests ", "__proto__", "../x"]) expect(parseTab(bad as any)).toBe("overview");
  });

  it("parses the trade mode (direct unless explicitly open)", () => {
    expect(parseMode("open")).toBe("open");
    for (const v of [null, undefined, "", "direct", "OPEN", "yes"]) expect(parseMode(v as any)).toBe("direct");
  });

  it("builds clean links, omitting defaults", () => {
    expect(launchpadHref()).toBe("/launchpad");
    expect(launchpadHref("overview")).toBe("/launchpad");
    expect(launchpadHref("new")).toBe("/launchpad?tab=new");
    expect(launchpadHref("requests")).toBe("/launchpad?tab=requests");
    expect(launchpadHref("new", "open")).toBe("/launchpad?tab=new&mode=open");
    expect(launchpadHref("history", "open")).toBe("/launchpad?tab=history&mode=open");
  });

  it("the Requests link used by the navbar is exactly /launchpad?tab=requests", () => {
    expect(launchpadHref("requests")).toBe("/launchpad?tab=requests");
    expect(HOW_IT_WORKS_HREF).toBe("/#how-it-works");
  });

  it("updates the tab or mode in a query string and keeps unrelated parameters", () => {
    expect(withState("", { tab: "requests" })).toBe("tab=requests");
    expect(withState("?tab=requests", { tab: "overview" })).toBe("");
    expect(withState("tab=history&utm_source=x", { tab: "public" })).toBe("tab=public&utm_source=x");
    expect(withState("tab=requests", { mode: "open" })).toBe("tab=requests&mode=open");
    expect(withState("mode=open&tab=requests", { mode: "direct" })).toBe("tab=requests");
    expect(withState("a=1", {})).toBe("a=1");
  });

  it("round-trips: what launchpadHref writes, parseTab/parseMode read back", () => {
    for (const tab of TABS) {
      for (const mode of ["direct", "open"] as const) {
        const q = new URLSearchParams(launchpadHref(tab, mode).split("?")[1] ?? "");
        expect([parseTab(q.get("tab")), parseMode(q.get("mode"))]).toEqual([tab, mode]);
      }
    }
  });
});
