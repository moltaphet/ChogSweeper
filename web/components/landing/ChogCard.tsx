"use client";

import { BadgeCheck } from "lucide-react";
import { CHOG_ART, RARITY_LABEL, RARITY_STYLE } from "@/lib/chogArt";
import { chogArtFor } from "@/lib/chogArt";

/** The official artwork for a token id (or for catalog slot `slot`, to pick a specific picture). */
export function ChogImage({ id, slot, className = "h-full w-full" }: { id: number; slot?: number; className?: string }) {
  const art = slot === undefined ? chogArtFor(id) : CHOG_ART[slot % CHOG_ART.length]!;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={art.src} alt="" width={560} height={560} className={`${className} object-contain`} decoding="async" draggable={false} />;
}

/**
 * A Chog trading card: the artwork (it carries its own purple frame) with a drop shadow, a holographic sheen and a label
 * under it with the name and rarity. `slot` picks a specific picture from the catalog; without it the id decides.
 */
export function ChogCard({ id, slot, className = "", compact, dark, bare }: { id: number; slot?: number; className?: string; compact?: boolean; /** Label text for dark backgrounds. */ dark?: boolean; /** Art only, no label. */ bare?: boolean }) {
  const art = slot === undefined ? chogArtFor(id) : CHOG_ART[slot % CHOG_ART.length]!;
  return (
    <div className={`group relative flex flex-col ${className}`}>
      <div className="relative aspect-square w-full">
        <ChogImage id={id} slot={slot} className="h-full w-full drop-shadow-[0_22px_26px_rgba(20,8,70,0.45)]" />
        {/* holographic sheen sweeping across the art */}
        <div
          className="pointer-events-none absolute inset-[7%] animate-sheen rounded-[22%] bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.5)_48%,rgba(255,200,255,0.25)_52%,transparent_65%)] bg-[length:250%_100%] mix-blend-overlay"
          aria-hidden
        />
      </div>
      {!bare && (
      <div className={`flex items-center justify-between gap-1.5 ${compact ? "px-1 pt-1" : "px-2 pt-2"}`}>
        <p className={`whitespace-nowrap font-display font-extrabold leading-none ${dark ? "text-white" : "text-monad-ink"} ${compact ? "text-[11px]" : "text-[15px]"}`}>Chog #{id}</p>
        {compact ? (
          <BadgeCheck className="h-3.5 w-3.5 text-status-active" aria-label="Verified" />
        ) : (
          <span className={`inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${dark ? "bg-white/15 text-white ring-1 ring-white/30" : RARITY_STYLE[art.rarity]}`}>
            <BadgeCheck className="h-3 w-3 shrink-0" aria-hidden /> <span className="truncate">{RARITY_LABEL[art.rarity]}</span>
          </span>
        )}
      </div>
      )}
    </div>
  );
}
