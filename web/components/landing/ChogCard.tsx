"use client";

import { CHOG_ART, chogArtFor } from "@/lib/chogArt";

/** The official artwork for a token id (or for catalog slot `slot`, to pick a specific picture). */
export function ChogImage({ id, slot, className = "h-full w-full" }: { id: number; slot?: number; className?: string }) {
  const art = slot === undefined ? chogArtFor(id) : CHOG_ART[slot % CHOG_ART.length]!;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={art.src} alt="" width={560} height={560} className={`${className} object-contain`} decoding="async" draggable={false} />;
}

/**
 * A Chog card: just the artwork (it carries its own purple frame) with a holographic sheen sweeping over it. No labels, no
 * shadow or box around it. `slot` picks a specific picture from the catalog; without it the id decides.
 */
export function ChogCard({ id, slot, className = "" }: { id: number; slot?: number; className?: string }) {
  return (
    <div className={`relative aspect-square ${className}`}>
      <ChogImage id={id} slot={slot} className="h-full w-full" />
      <div
        className="pointer-events-none absolute inset-[7%] animate-sheen rounded-[22%] bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.5)_48%,rgba(255,200,255,0.25)_52%,transparent_65%)] bg-[length:250%_100%] mix-blend-overlay"
        aria-hidden
      />
    </div>
  );
}
