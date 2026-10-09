import { BadgeCheck, Check } from "lucide-react";

/** A cheerful blob character: purely illustrative, so no real artwork is implied. */
function ChogFace({ hue }: { hue: number }) {
  return (
    <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden>
      <path d="M44 28c4-12 14-16 20-8 4-8 14-4 14 8" fill={`hsl(${hue} 70% 52%)`} />
      <ellipse cx="60" cy="68" rx="44" ry="40" fill={`hsl(${hue} 72% 64%)`} />
      <ellipse cx="60" cy="78" rx="29" ry="21" fill={`hsl(${hue} 85% 88%)`} />
      <circle cx="43" cy="58" r="9" fill="#fff" /><circle cx="77" cy="58" r="9" fill="#fff" />
      <circle cx="45" cy="59" r="4.6" fill="#1C1536" /><circle cx="79" cy="59" r="4.6" fill="#1C1536" />
      <circle cx="46.6" cy="57.2" r="1.5" fill="#fff" /><circle cx="80.6" cy="57.2" r="1.5" fill="#fff" />
      <path d="M49 80q11 10 22 0" fill="none" stroke="#1C1536" strokeWidth="3.4" strokeLinecap="round" />
      <ellipse cx="32" cy="76" rx="6" ry="4" fill="#FF9EC4" opacity=".55" /><ellipse cx="88" cy="76" rx="6" ry="4" fill="#FF9EC4" opacity=".55" />
    </svg>
  );
}

function Card({ id, hue, tilt, className }: { id: number; hue: number; tilt: string; className: string }) {
  return (
    <div className={`absolute top-8 w-32 rounded-3xl border border-white/80 bg-white p-2 shadow-glow sm:w-[168px] sm:p-2.5 ${tilt} ${className}`}>
      <div className="aspect-square rounded-2xl p-2" style={{ background: `linear-gradient(160deg, hsl(${hue} 90% 95%), hsl(${hue} 80% 86%))` }}>
        <ChogFace hue={hue} />
      </div>
      <div className="px-1 pb-1 pt-2">
        <p className="font-display text-sm font-bold leading-tight sm:text-base">Chog #{id}</p>
        <p className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-status-activeInk sm:text-xs">
          <BadgeCheck className="h-3 w-3 text-status-active sm:h-3.5 sm:w-3.5" aria-hidden /> Verified
        </p>
      </div>
    </div>
  );
}

/**
 * The page's one moment of motion: two Chogs trade places on an arc while MON changes hands, then a chip confirms
 * the settlement. Under prefers-reduced-motion the cards simply rest in their start positions.
 */
export function HeroArt() {
  return (
    <figure className="relative mx-auto h-[330px] w-full max-w-[440px] select-none [--dx:192px] sm:h-[360px] sm:[--dx:272px]" aria-label="Illustration: two Chog NFTs trading places while MON changes hands">
      <div className="absolute -inset-x-3 -inset-y-10 -z-10 rounded-full sm:-inset-x-10 bg-[radial-gradient(closest-side,rgba(131,110,249,0.28),transparent)] blur-2xl" aria-hidden />
      <div className="absolute inset-x-6 top-1/2 -z-10 h-px bg-gradient-to-r from-transparent via-monad-primary/40 to-transparent" aria-hidden />

      <Card id={7} hue={262} tilt="" className="left-0 animate-swap-a" />
      <Card id={21} hue={292} tilt="" className="right-0 animate-swap-b" />

      <div className="absolute left-1/2 top-[42%] -translate-x-1/2 animate-coin-bob" aria-hidden>
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-[#FFD479] to-coin shadow-[0_10px_24px_-8px_rgba(245,181,68,0.9)] sm:h-16 sm:w-16">
          <span className="text-center font-display text-[11px] font-black leading-tight text-coin-ink sm:text-xs">+0.5<br />MON</span>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex justify-center" aria-hidden>
        <span className="inline-flex animate-settle-chip items-center gap-1.5 rounded-full border border-status-active/40 bg-white/95 px-3.5 py-1.5 text-xs font-semibold text-status-activeInk shadow-card opacity-0">
          <Check className="h-3.5 w-3.5 text-status-active" strokeWidth={3} /> Settled atomically
        </span>
      </div>
      <figcaption className="sr-only">Illustration only.</figcaption>
    </figure>
  );
}
