/** The .MON ticker artwork, sized to the surrounding text (1em tall by default) so it can replace the word "MON" inline. */
export function MonTicker({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/mon.png" alt="MON" width={480} height={152} decoding="async" className={`inline-block h-[1.15em] w-auto select-none align-[-0.2em] ${className}`} />
  );
}
