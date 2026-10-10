"use client";

import { BadgeCheck } from "lucide-react";
import { useState } from "react";
import { ChogPortrait, traitsOf } from "./ChogArt";

/**
 * Optional real artwork. Put the official images in `web/public/chogs/` named `<id>.png` (or .webp) and set
 * NEXT_PUBLIC_CHOG_ART_BASE=/chogs/ (+ NEXT_PUBLIC_CHOG_ART_EXT=png). Any id whose file fails to load falls back to the
 * built-in vector Chog, so a partial set of images is fine.
 */
const ART_BASE = process.env.NEXT_PUBLIC_CHOG_ART_BASE ?? "";
const ART_EXT = process.env.NEXT_PUBLIC_CHOG_ART_EXT ?? "png";

export function ChogImage({ id, className = "h-full w-full" }: { id: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!ART_BASE || failed) return <ChogPortrait id={id} className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`${ART_BASE}${id}.${ART_EXT}`} alt="" className={`${className} object-cover`} onError={() => setFailed(true)} decoding="async" />;
}

/** A trading-card frame around a Chog: glass border, holographic sheen, verified mark and one trait chip. */
export function ChogCard({ id, className = "", compact }: { id: number; className?: string; compact?: boolean }) {
  const t = traitsOf(id);
  return (
    <div className={`group relative rounded-[26px] bg-gradient-to-b from-white/90 to-white/55 p-[7px] shadow-[0_30px_60px_-20px_rgba(20,8,70,0.7),0_0_0_1px_rgba(255,255,255,0.6)_inset] backdrop-blur ${className}`}>
      <div className="relative aspect-square overflow-hidden rounded-[20px]">
        <ChogImage id={id} />
        {/* holographic sheen sweeping across the art */}
        <div className="pointer-events-none absolute inset-0 animate-sheen bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.45)_48%,rgba(255,200,255,0.25)_52%,transparent_65%)] bg-[length:250%_100%] mix-blend-overlay" aria-hidden />
        <div className="pointer-events-none absolute inset-0 rounded-[20px] ring-1 ring-inset ring-white/50" aria-hidden />
      </div>
      <div className={`flex items-center justify-between gap-2 px-1.5 ${compact ? "pb-0.5 pt-1.5" : "pb-1 pt-2.5"}`}>
        <p className={`whitespace-nowrap font-display font-extrabold leading-none text-monad-ink ${compact ? "text-xs" : "text-[15px]"}`}>Chog #{id}</p>
        {compact ? (
          <BadgeCheck className="h-3.5 w-3.5 text-status-active" aria-label="Verified" />
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-status-activeBg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-status-activeInk">
            <BadgeCheck className="h-3 w-3 shrink-0" aria-hidden /> <span className="truncate">{t.hat === "none" ? "Verified" : t.hat}</span>
          </span>
        )}
      </div>
    </div>
  );
}
