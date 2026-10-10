import { useId } from "react";

/**
 * Original vector Chog illustrations, drawn here and generated from a token id (the same id always gives the same Chog).
 * They are NOT the official collection art. Vector means they stay razor sharp at any size, 4K included. To show the real
 * artwork instead, set NEXT_PUBLIC_CHOG_ART_BASE (see `ChogPortrait`).
 */

const HUES = [262, 280, 300, 322, 244, 210, 340] as const;
const HATS = ["none", "crown", "cap", "halo", "headphones", "party", "none", "crown"] as const;
const EYES = ["round", "happy", "shades", "sleepy", "wide"] as const;
const MOUTHS = ["smile", "open", "tongue", "grin"] as const;
const BACKS = ["aurora", "sunset", "mint", "peach", "night"] as const;

export type Hat = (typeof HATS)[number];

export interface ChogTraits {
  hue: number;
  hat: Hat;
  eyes: (typeof EYES)[number];
  mouth: (typeof MOUTHS)[number];
  back: (typeof BACKS)[number];
}

function hash(n: number): number {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

export function traitsOf(id: number): ChogTraits {
  const h = hash(id);
  return {
    hue: HUES[h % HUES.length]!,
    hat: HATS[(h >>> 3) % HATS.length]!,
    eyes: EYES[(h >>> 7) % EYES.length]!,
    mouth: MOUTHS[(h >>> 11) % MOUTHS.length]!,
    back: BACKS[(h >>> 15) % BACKS.length]!,
  };
}

const BACK_STOPS: Record<ChogTraits["back"], [string, string, string]> = {
  aurora: ["#EDE9FF", "#C9BDFF", "#9B86FF"],
  sunset: ["#FFE9F3", "#FFB8D8", "#C98BFF"],
  mint: ["#E6FFF6", "#9BF0D2", "#7AA8FF"],
  peach: ["#FFF1E3", "#FFC9A3", "#FF9CC3"],
  night: ["#3B2A8F", "#241A63", "#140E3D"],
};

/** A full square Chog portrait: backdrop, character, accessories. Pure SVG, no raster, no external request. */
export function ChogPortrait({ id, className = "h-full w-full", title }: { id: number; className?: string; title?: string }) {
  const uid = useId().replace(/:/g, "");
  const t = traitsOf(id);
  const [b0, b1, b2] = BACK_STOPS[t.back];
  const dark = t.back === "night";
  const body = (l: number, s = 72) => `hsl(${t.hue} ${s}% ${l}%)`;
  const ink = "#1C1536";

  return (
    <svg viewBox="0 0 200 200" className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} shapeRendering="geometricPrecision">
      <defs>
        <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={b0} /><stop offset=".55" stopColor={b1} /><stop offset="1" stopColor={b2} />
        </linearGradient>
        <radialGradient id={`body${uid}`} cx=".34" cy=".26" r=".95">
          <stop offset="0" stopColor={body(80, 85)} /><stop offset=".5" stopColor={body(62)} /><stop offset="1" stopColor={body(40, 70)} />
        </radialGradient>
        <radialGradient id={`belly${uid}`} cx=".5" cy=".3" r=".8">
          <stop offset="0" stopColor={body(97, 90)} /><stop offset="1" stopColor={body(84, 85)} />
        </radialGradient>
        <radialGradient id={`glow${uid}`} cx=".5" cy=".55" r=".6">
          <stop offset="0" stopColor="#fff" stopOpacity={dark ? 0.22 : 0.65} /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`gold${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE08A" /><stop offset="1" stopColor="#F0A92E" />
        </linearGradient>
        <filter id={`soft${uid}`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>

      <rect width="200" height="200" fill={`url(#bg${uid})`} />
      <circle cx="100" cy="112" r="86" fill={`url(#glow${uid})`} />
      {/* sparkles */}
      {[[28, 36, 5], [172, 52, 4], [160, 150, 3.2], [36, 142, 3.6]].map(([x, y, r], i) => (
        <path key={i} d={`M${x} ${y! - r!}L${x! + r! * 0.32} ${y! - r! * 0.32}L${x! + r!} ${y}L${x! + r! * 0.32} ${y! + r! * 0.32}L${x} ${y! + r!}L${x! - r! * 0.32} ${y! + r! * 0.32}L${x! - r!} ${y}L${x! - r! * 0.32} ${y! - r! * 0.32}Z`} fill="#fff" opacity={dark ? 0.7 : 0.85} />
      ))}

      {/* ground shadow */}
      <ellipse cx="100" cy="176" rx="52" ry="8" fill={ink} opacity=".18" filter={`url(#soft${uid})`} />

      {/* tuft */}
      <path d="M86 58c-6-16 4-28 14-30 2 8-1 14-4 20 7-6 16-6 22-2-6 8-14 12-24 12Z" fill={body(46, 75)} />
      <path d="M92 56c-2-8 2-16 8-20-1 6 0 10 3 14-3 3-7 5-11 6Z" fill={body(72, 85)} opacity=".7" />

      {/* hands */}
      <ellipse cx="46" cy="140" rx="13" ry="10" fill={body(56)} transform="rotate(-18 46 140)" />
      <ellipse cx="154" cy="140" rx="13" ry="10" fill={body(56)} transform="rotate(18 154 140)" />

      {/* body */}
      <path d="M100 52c42 0 70 28 70 66 0 32-26 54-70 54s-70-22-70-54c0-38 28-66 70-66Z" fill={`url(#body${uid})`} />
      <path d="M52 92c10-20 30-30 50-30" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="100" cy="140" rx="40" ry="28" fill={`url(#belly${uid})`} />

      {/* cheeks */}
      <ellipse cx="55" cy="126" rx="10" ry="6.5" fill="#FF8FBF" opacity=".55" />
      <ellipse cx="145" cy="126" rx="10" ry="6.5" fill="#FF8FBF" opacity=".55" />

      {/* eyes */}
      {t.eyes === "shades" ? (
        <g>
          <path d="M54 98h92v4c0 12-9 20-20 20-9 0-14-5-17-12h-8c-3 7-8 12-17 12-11 0-20-8-20-20Z" fill={ink} />
          <path d="M60 100h22" stroke="#8B7DFF" strokeWidth="3" strokeLinecap="round" opacity=".8" />
          <path d="M118 100h22" stroke="#8B7DFF" strokeWidth="3" strokeLinecap="round" opacity=".8" />
        </g>
      ) : t.eyes === "happy" ? (
        <g fill="none" stroke={ink} strokeWidth="5.5" strokeLinecap="round">
          <path d="M62 108q14-18 28 0" /><path d="M110 108q14-18 28 0" />
        </g>
      ) : t.eyes === "sleepy" ? (
        <g>
          <circle cx="76" cy="106" r="14" fill="#fff" /><circle cx="124" cy="106" r="14" fill="#fff" />
          <path d="M62 106h28v2a14 14 0 0 1-28 0Z" fill={ink} /><path d="M110 106h28v2a14 14 0 0 1-28 0Z" fill={ink} />
          <path d="M60 104h32M108 104h32" stroke={ink} strokeWidth="4.5" strokeLinecap="round" />
        </g>
      ) : (
        <g>
          <circle cx="76" cy="104" r={t.eyes === "wide" ? 17 : 14} fill="#fff" /><circle cx="124" cy="104" r={t.eyes === "wide" ? 17 : 14} fill="#fff" />
          <circle cx="79" cy="106" r={t.eyes === "wide" ? 9 : 8} fill={ink} /><circle cx="127" cy="106" r={t.eyes === "wide" ? 9 : 8} fill={ink} />
          <circle cx="82" cy="102.5" r="3" fill="#fff" /><circle cx="130" cy="102.5" r="3" fill="#fff" />
          <circle cx="76" cy="109.5" r="1.6" fill="#fff" opacity=".8" /><circle cx="124" cy="109.5" r="1.6" fill="#fff" opacity=".8" />
        </g>
      )}

      {/* mouth */}
      {t.mouth === "smile" && <path d="M84 134q16 14 32 0" fill="none" stroke={ink} strokeWidth="4.5" strokeLinecap="round" />}
      {t.mouth === "grin" && (
        <g><path d="M80 130q20 24 40 0Z" fill={ink} /><path d="M86 133h28q-14 7-28 0Z" fill="#fff" /></g>
      )}
      {t.mouth === "open" && (
        <g><path d="M86 130q14 26 28 0Z" fill={ink} /><ellipse cx="100" cy="143" rx="7" ry="4" fill="#FF7FAE" /></g>
      )}
      {t.mouth === "tongue" && (
        <g><path d="M84 132q16 12 32 0" fill="none" stroke={ink} strokeWidth="4.5" strokeLinecap="round" /><path d="M96 139q4 12 10 0Z" fill="#FF7FAE" stroke={ink} strokeWidth="2.4" strokeLinejoin="round" /></g>
      )}

      {/* hats */}
      {t.hat === "crown" && (
        <g>
          <path d="M70 62l8-26 14 16 8-22 8 22 14-16 8 26Z" fill={`url(#gold${uid})`} stroke="#C98414" strokeWidth="2.4" strokeLinejoin="round" />
          <rect x="70" y="60" width="60" height="9" rx="3" fill="#F0A92E" stroke="#C98414" strokeWidth="2.4" />
          <circle cx="100" cy="42" r="3.4" fill="#FF6FA3" /><circle cx="78" cy="42" r="2.4" fill="#7DE3FF" /><circle cx="122" cy="42" r="2.4" fill="#7DE3FF" />
        </g>
      )}
      {t.hat === "cap" && (
        <g>
          <path d="M64 70c0-22 16-34 36-34s36 12 36 34Z" fill="#FF5C8A" /><path d="M64 70h84c0 6-10 8-20 8H72c-6 0-8-4-8-8Z" fill="#E03E6E" />
          <path d="M82 44q8-6 18-6" stroke="#fff" strokeOpacity=".55" strokeWidth="4" strokeLinecap="round" fill="none" /><circle cx="100" cy="37" r="3.5" fill="#fff" />
        </g>
      )}
      {t.hat === "halo" && (
        <ellipse cx="100" cy="34" rx="30" ry="8" fill="none" stroke={`url(#gold${uid})`} strokeWidth="6" />
      )}
      {t.hat === "headphones" && (
        <g>
          <path d="M44 112c-4-44 22-64 56-64s60 20 56 64" fill="none" stroke={ink} strokeWidth="7" strokeLinecap="round" />
          <rect x="34" y="100" width="18" height="34" rx="9" fill="#7B5CFF" stroke={ink} strokeWidth="3" /><rect x="148" y="100" width="18" height="34" rx="9" fill="#7B5CFF" stroke={ink} strokeWidth="3" />
        </g>
      )}
      {t.hat === "party" && (
        <g>
          <path d="M100 18l26 44H74Z" fill="#FFC857" /><path d="M86 42l28 0M80 54l40 0" stroke="#FF5C8A" strokeWidth="4" />
          <circle cx="100" cy="18" r="5" fill="#FF5C8A" />
        </g>
      )}
    </svg>
  );
}
