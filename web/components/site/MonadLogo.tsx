/** The Monad logo (public/monad.png), used wherever a MON coin would otherwise be drawn. */
export function MonadLogo({ className = "h-4 w-4" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/monad.png" alt="" width={256} height={256} decoding="async" draggable={false} className={`inline-block shrink-0 select-none object-contain ${className}`} aria-hidden />
  );
}
