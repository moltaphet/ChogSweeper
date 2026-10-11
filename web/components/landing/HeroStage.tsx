"use client";

import { useEffect, useRef } from "react";
import { ChogCard } from "./ChogCard";

/** Where each card sits in the fan. x/y are percentages of the scene; px/py are how far the mouse moves it (depth). */
const CARDS = [
  { id: 88, slot: 5, x: 0, y: 34, w: 150, r: -14, px: -8, py: -4, ry: 10, z: 1, dur: 8.5, fy: -10 },
  { id: 3, slot: 0, x: 74, y: 30, w: 150, r: 13, px: -8, py: -4, ry: -10, z: 1, dur: 9.5, fy: -12 },
  { id: 21, slot: 1, x: 10, y: 50, w: 190, r: -7, px: 14, py: 7, ry: 12, z: 2, dur: 7, fy: -14 },
  { id: 42, slot: 7, x: 56, y: 48, w: 190, r: 7, px: 14, py: 7, ry: -12, z: 2, dur: 7.8, fy: -16 },
  { id: 7, slot: 2, x: 33, y: 5, w: 236, r: 0, px: 26, py: 14, ry: 8, z: 3, dur: 6.5, fy: -18 },
] as const;

const SPARKS = Array.from({ length: 22 }, (_, i) => ({
  x: (i * 37 + 11) % 100,
  y: (i * 53 + 7) % 100,
  s: 2 + (i % 3),
  d: 2.4 + (i % 5) * 0.7,
  delay: (i % 7) * 0.5,
}));

/**
 * The hero's right half: a fan of holographic Chog cards floating over a spinning swap portal, with
 * twinkling sparks and a perspective grid floor. Pointer movement tilts the whole scene a little and moves each card by its depth.
 */
export function HeroScene() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", String(Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2))));
        el.style.setProperty("--my", String(Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2))));
      });
    };
    const leave = () => {
      el.style.setProperty("--mx", "0");
      el.style.setProperty("--my", "0");
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="relative mx-auto h-[420px] w-full max-w-[640px] select-none [--k:0.72] sm:h-[540px] sm:[--k:0.9] lg:h-[600px] lg:[--k:1]"
      style={{ perspective: "1400px", ["--mx" as string]: 0, ["--my" as string]: 0 }}
      role="img"
      aria-label="Illustration: a fan of Chog NFTs floating above a swap portal"
    >
      {/* portal */}
      <div className="absolute left-1/2 top-[52%] aspect-square w-[88%] -translate-x-1/2 -translate-y-1/2" aria-hidden>
        <div className="absolute inset-0 animate-spin-slow rounded-full [background:conic-gradient(from_0deg,transparent,rgba(139,92,246,0.9),transparent_35%,rgba(236,72,153,0.7),transparent_70%,rgba(56,189,248,0.7),transparent)] [mask-image:radial-gradient(farthest-side,transparent_calc(100%-3px),#000_calc(100%-2px))]" />
        <div className="absolute inset-[9%] animate-spin-rev rounded-full [background:conic-gradient(from_90deg,transparent,rgba(196,181,253,0.8),transparent_40%,rgba(255,255,255,0.5),transparent_75%)] [mask-image:radial-gradient(farthest-side,transparent_calc(100%-2px),#000_calc(100%-1px))]" />
        <div className="absolute inset-[18%] rounded-full bg-[radial-gradient(closest-side,rgba(168,139,250,0.55),rgba(91,33,182,0.25)_55%,transparent)] blur-xl" />
        <div className="absolute inset-[3%] rounded-full border border-dashed border-white/15" />
      </div>

      {/* sparks */}
      {SPARKS.map((s, i) => (
        <span key={i} className="absolute animate-twinkle rounded-full bg-white" style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, ["--dur" as string]: `${s.d}s`, animationDelay: `${s.delay}s`, boxShadow: "0 0 8px 1px rgba(255,255,255,0.8)" }} aria-hidden />
      ))}

      {/* the fan of cards */}
      {CARDS.map((c) => (
        <div
          key={c.id}
          className="absolute"
          style={{
            left: `${c.x}%`,
            top: `${c.y}%`,
            width: `calc(${c.w}px * var(--k))`,
            zIndex: c.z,
            transform: `translate3d(calc(var(--mx) * ${c.px}px), calc(var(--my) * ${c.py}px), 0) rotateY(calc(var(--mx) * ${c.ry}deg)) rotateX(calc(var(--my) * -6deg))`,
            transition: "transform 0.25s ease-out",
            transformStyle: "preserve-3d",
          }}
        >
          <div className="animate-float" style={{ ["--r" as string]: `${c.r}deg`, ["--dur" as string]: `${c.dur}s`, ["--fy" as string]: `${c.fy}px`, transform: `rotate(${c.r}deg)` }}>
            <ChogCard id={c.id} slot={c.slot} />
          </div>
        </div>
      ))}

      {/* settle chip */}
      <div className="absolute inset-x-0 bottom-1 z-10 flex justify-center" aria-hidden>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)] backdrop-blur-md">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.8)]" /> Atomic swap · one transaction
        </span>
      </div>
    </div>
  );
}
