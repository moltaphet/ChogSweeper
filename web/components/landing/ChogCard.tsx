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
 * under it with its rarity chip (no id). `slot` picks a specific picture from the catalog; without it the id decides.
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
        <div className={`flex items-center justify-center ${compact ? "pt-1" : "pt-2"}`}>
          <span className={`inline-flex items-center gap-1 rounded-full font-bold uppercase tracking-wide ${compact ? "px-1.5 py-0.5 text-[9px]" : "px-2.5 py-0.5 text-[10px]"} ${dark ? "bg-white/15 text-white ring-1 ring-white/30" : RARITY_STYLE[art.rarity]}`}>
            <BadgeCheck className={`shrink-0 ${compact ? "h-2.5 w-2.5" : "h-3 w-3"}`} aria-hidden /> {RARITY_LABEL[art.rarity]}
          </span>
        </div>
      )}
    </div>
  );
}
