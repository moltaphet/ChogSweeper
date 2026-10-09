"use client";

import { useState } from "react";
import { AddTokenForm } from "@/components/AddTokenForm";
import { NavLinks } from "@/components/site/NavLinks";
import { NAV } from "@/lib/site";
import { GridSkeleton, NFTSelectorGrid } from "@/components/NFTSelectorGrid";
import { TradeDetailModal } from "@/components/TradeDetailModal";
import { TradeList } from "@/components/TradeList";
import { StatusBadge } from "@/components/StatusBadge";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { nftKey } from "@/lib/format";
import type { NFTItem, SwapRecord, SwapStatus } from "@/lib/types";

const art = (hue: number, label: string) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' fill='hsl(${hue} 80% 88%)'/><circle cx='100' cy='88' r='46' fill='hsl(${hue} 70% 60%)'/><text x='100' y='178' font-size='22' font-family='sans-serif' text-anchor='middle' fill='hsl(${hue} 40% 25%)'>${label}</text></svg>`,
  );

const CHOG = "0x00000000000000000000000000000000000c0c0c" as const;
const MON = "0x000000000000000000000000000000000000d0d0" as const;
const RAND = "0x000000000000000000000000000000000000e1e1" as const;
const A = "0x00000000000000000000000000000000000000a1" as const;
const B = "0x00000000000000000000000000000000000000b2" as const;

const base = { description: null, imageFallbacks: [] as string[], traits: [] as { trait_type: string; value: string }[], meta: "ok" as const };
const chog = (id: number): NFTItem => ({ ...base, contract: CHOG, tokenId: BigInt(id), name: `Chog #${id}`, collectionName: "Chog", image: art(265, `#${id}`), isChog: true, verified: true, ecosystem: "chog", traits: [{ trait_type: "Hat", value: "Red" }, { trait_type: "Eyes", value: "Laser" }, { trait_type: "Mood", value: "Chill" }] });
const mon = (id: number): NFTItem => ({ ...base, contract: MON, tokenId: BigInt(id), name: `Molandak #${id}`, collectionName: "Molandak", image: art(150, `#${id}`), isChog: false, verified: true, ecosystem: "monad", traits: [{ trait_type: "Background", value: "Mint" }] });
const rand = (id: number): NFTItem => ({ ...base, contract: RAND, tokenId: BigInt(id), name: `Lookalike #${id}`, collectionName: "Chogg", image: art(25, `#${id}`), isChog: false, verified: false, ecosystem: null });
// First gateway is dead (404), the second works: the image must still appear.
const gatewayFallback = (id: number): NFTItem => ({ ...mon(id), name: `Fallback #${id}`, image: "/__dead-gateway__/a.png", imageFallbacks: ["/__dead-gateway__/b.png", art(200, `#${id}`)] });
// Every source is dead: the placeholder with token id + collection name must show.
const allDead = (id: number): NFTItem => ({ ...mon(id), name: `Dead images #${id}`, collectionName: "Molandak", image: "/__dead__/a.png", imageFallbacks: ["/__dead__/b.png"], traits: [] });
const unresolved = (id: number): NFTItem => ({ ...chog(id), name: `Chog #${id}`, image: null, traits: [], meta: "unresolved" });

const trade = (id: number, status: SwapStatus, o: Partial<SwapRecord>): SwapRecord => ({
  id: BigInt(id), maker: A, taker: B, status, expiry: Math.floor(Date.now() / 1000) + 7500,
  offered: [], wanted: [], offeredMon: 0n, wantedMon: 0n, createdTx: "0x" + "ab".repeat(32), ...o,
});

const TRADES: SwapRecord[] = [
  trade(12, "pending", { offered: [chog(7), chog(21)], offeredMon: 1_500_000_000_000_000_000n, wanted: [mon(3)] }),
  trade(11, "pending", { offered: [chog(9)], wanted: [rand(5)], wantedMon: 250_000_000_000_000_000n }),
  trade(10, "expired", { expiry: Math.floor(Date.now() / 1000) - 4000, offered: [mon(8)], wanted: [] }),
  trade(9, "completed", { offered: [chog(2)], wanted: [mon(1), mon(2)], settledTx: "0x" + "cd".repeat(32), feePaid: 100_000_000_000_000_000n }),
  trade(8, "cancelled", { offered: [chog(4)], offeredMon: 3_000_000_000_000_000_000n }),
  trade(7, "declined", { offered: [mon(6)] }),
];

export function DevPreview() {
  const [open, setOpen] = useState<SwapRecord | null>(null);
  const [sel, setSel] = useState(new Set<string>([nftKey(chog(7))]));
  const items = [chog(7), chog(9), mon(3), gatewayFallback(11), allDead(12), unresolved(31), rand(5), { ...mon(40), custom: true }];
  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-10">
      <section className="space-y-4">
        <h2 className="text-lg font-bold">Navigation (3 unread incoming requests)</h2>
        <div className="rounded-2xl border border-monad-border bg-white/70 p-3"><NavLinks items={NAV} active="requests" unread={3} /></div>
        <div className="max-w-xs rounded-2xl border border-monad-border bg-white/70 p-3"><NavLinks items={NAV} active="swap" unread={120} variant="stack" /></div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-bold">Badges</h2>
        <div className="flex flex-wrap items-center gap-3">
          <VerifiedBadge isChog verified ecosystem="chog" />
          <VerifiedBadge verified ecosystem="monad" />
          <VerifiedBadge showUnverified />
          {(["pending", "completed", "cancelled", "declined", "expired"] as SwapStatus[]).map((s) => <StatusBadge key={s} status={s} />)}
        </div>
      </section>
      <section className="card p-6">
        <h2 className="mb-3 text-lg font-bold">Selector grid</h2>
        <NFTSelectorGrid items={items} selected={sel} max={10} emptyMessage="" onToggle={(i) => setSel((s) => { const n = new Set(s); const k = nftKey(i); n.has(k) ? n.delete(k) : n.add(k); return n; })} />
      </section>
      <section className="card p-6">
        <h2 className="mb-3 text-lg font-bold">Loading skeleton</h2>
        <GridSkeleton />
      </section>
      <section className="card p-6">
        <h2 className="mb-1 text-lg font-bold">Add by contract + token ID</h2>
        <p className="mb-2 text-xs text-monad-muted">Mock lookup: token 1 succeeds, 2 belongs to someone else, anything else is not found.</p>
        <AddTokenForm
          onAdd={async (contract, id) => {
            await new Promise((r) => setTimeout(r, 400));
            if (id === "1") return { ok: true, item: { ...chog(1), custom: true } };
            if (id === "2") return { ok: false, error: "This token is owned by 0x0000…00b2, not 0x0000…00a1." };
            return { ok: false, error: "token does not exist, or the contract is not an ERC-721" };
          }}
        />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-bold">Trades</h2>
        <TradeList trades={TRADES} loading={false} emptyMessage="" onOpen={setOpen} />
      </section>
      <TradeDetailModal trade={open} onClose={() => setOpen(null)} />
    </main>
  );
}
