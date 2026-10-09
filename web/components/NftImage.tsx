"use client";

import { Gem } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  src: string | null | undefined;
  /** Other URLs for the same image, tried in order when one fails or stalls. */
  fallbacks?: readonly string[];
  alt: string;
  collectionName: string;
  tokenId: string | bigint;
  className?: string;
  /** Compact placeholder (token id only) for small thumbnails. */
  compact?: boolean;
}

/**
 * How long one source may stay silent before the next is tried. Our own image proxy gets far longer than a direct URL: on a
 * cold cache it legitimately spends several seconds asking IPFS gateways, and giving up on it early would throw away the
 * one source that is actually going to work.
 */
const STALL_DIRECT_MS = 8_000;
const STALL_PROXY_MS = 25_000;
const stallFor = (src: string) => (src.startsWith("/api/nft/image") ? STALL_PROXY_MS : STALL_DIRECT_MS);

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/**
 * An NFT image that survives bad sources: it advances through `fallbacks` on error or stall, shows a lavender skeleton while
 * loading, and if nothing loads renders a generated Monad-purple card with the collection name and token ID instead of a
 * broken image or empty space.
 */
export function NftImage({ src, fallbacks = [], alt, collectionName, tokenId, className = "", compact }: Props) {
  const sources = useMemo(() => [...new Set([src, ...fallbacks].filter((s): s is string => !!s))], [src, fallbacks]);
  const sourcesKey = sources.join("|");
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // New image set (e.g. the list refreshed): start over.
  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [sourcesKey]);

  // Load only once near the viewport, so a long inventory does not hit the network all at once and the stall timer never
  // runs against an image the browser has not been asked to fetch yet.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && (setVisible(true), io.disconnect()), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || loaded || index >= sources.length) return;
    const t = setTimeout(() => setIndex((i) => i + 1), stallFor(sources[index]!));
    return () => clearTimeout(t);
  }, [visible, loaded, index, sources]);

  const failed = index >= sources.length;

  return (
    <div ref={box} className={`relative overflow-hidden bg-monad-tint ${className}`}>
      {!failed && visible && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={sources[index]}
          src={sources[index]}
          alt={alt}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((i) => i + 1)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
      {!failed && !loaded && <Skeleton />}
      {failed && <Placeholder collectionName={collectionName} tokenId={tokenId} compact={compact} />}
    </div>
  );
}

/** Lavender shimmer: a soft highlight sweeps across a violet-tinted block. */
function Skeleton() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-monad-tint to-[#E4DEFD]" aria-hidden>
      <div className="absolute inset-y-0 -left-1/2 w-1/2 animate-[shimmer_1.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  );
}

/** A generated card, unique per collection + token, so a failed image still looks deliberate and identifiable. */
function Placeholder({ collectionName, tokenId, compact }: { collectionName: string; tokenId: string | bigint; compact?: boolean }) {
  const id = String(tokenId);
  const h = hash(`${collectionName}:${id}`);
  const hue = 245 + (h % 50); // always inside the Monad violet range
  // Three soft discs placed by the hash give each card its own composition.
  const discs = [0, 1, 2].map((i) => {
    const s = hash(`${collectionName}:${id}:${i}`);
    return { cx: 15 + (s % 70), cy: 15 + ((s >> 8) % 70), r: 18 + ((s >> 16) % 22), o: 0.18 + ((s >> 24) % 20) / 100 };
  });
  return (
    <div role="img" aria-label={`Image unavailable for ${collectionName} #${id}`} className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden p-1.5 text-center"
      style={{ background: `linear-gradient(150deg, hsl(${hue} 92% 95%), hsl(${hue + 12} 78% 84%))`, color: `hsl(${hue} 48% 26%)` }}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden>
        {discs.map((d, i) => <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill={`hsl(${hue + i * 14} 80% 62%)`} opacity={d.o} />)}
      </svg>
      <div className="relative flex flex-col items-center gap-0.5">
        {!compact && <Gem className="mb-1 h-6 w-6 opacity-80" strokeWidth={1.6} aria-hidden />}
        <span className={`font-display font-extrabold leading-none tracking-tight ${compact ? "text-[10px]" : "text-xl"}`}>#{id.length > 8 ? `${id.slice(0, 6)}…` : id}</span>
        {!compact && <span className="line-clamp-2 max-w-full px-2 text-[11px] font-semibold opacity-75">{collectionName}</span>}
      </div>
    </div>
  );
}
