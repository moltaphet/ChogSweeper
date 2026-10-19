import { SHOWCASE_ART } from "@/lib/testCollections";

/** Decorative artwork only; the showcase does not imply ownership of a token. */
export function NftCard({ id, slot, className = "" }: { id: number; slot?: number; className?: string }) {
  const index = ((slot ?? id) % SHOWCASE_ART.length + SHOWCASE_ART.length) % SHOWCASE_ART.length;
  const art = SHOWCASE_ART[index]!;
  return (
    <div className={`relative aspect-square ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art.src} alt="" width={640} height={640} loading="lazy" decoding="async" draggable={false} className="h-full w-full object-contain" />
      <div className="pointer-events-none absolute inset-[7%] animate-sheen rounded-[22%] bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.5)_48%,rgba(255,200,255,0.25)_52%,transparent_65%)] bg-[length:250%_100%] mix-blend-overlay" aria-hidden />
    </div>
  );
}
