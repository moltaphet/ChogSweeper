import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHOWCASE_ART, TEST_COLLECTIONS, testArtwork } from "../lib/testCollections";
import { launchpadHref, parseTab } from "../lib/routes";

describe("test collection artwork", () => {
  it("ships every variant and cycles token ids like the test contracts", () => {
    for (const c of TEST_COLLECTIONS) {
      for (let id = 1; id <= 10; id++) expect(existsSync(path.join(process.cwd(), "public", testArtwork(c.slug, id)))).toBe(true);
      expect(testArtwork(c.slug, 11)).toBe(testArtwork(c.slug, 1));
    }
  });
  it("keeps Chogs and replaces three quarters of decorative cards with the new collections", () => {
    expect(SHOWCASE_ART).toHaveLength(32);
    expect(SHOWCASE_ART.filter((a) => a.collection === "Chog")).toHaveLength(8);
    expect(new Set(SHOWCASE_ART.map((a) => a.collection)).size).toBe(4);
    for (const a of SHOWCASE_ART) expect(existsSync(path.join(process.cwd(), "public", a.src))).toBe(true);
  });
  it("supports shareable test NFT links", () => {
    expect(parseTab("test-nfts")).toBe("test-nfts");
    expect(launchpadHref("test-nfts")).toBe("/launchpad?tab=test-nfts");
  });
});
