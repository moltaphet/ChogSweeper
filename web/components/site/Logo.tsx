/** Brand mark: the Chog-with-swap-arrows logo (public/logo.png). It gives a small spin on hover, like the trade itself. */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="ChogSweeper"
      width={512}
      height={512}
      decoding="async"
      className={`${className} select-none object-contain transition-transform duration-500 ease-out group-hover/logo:rotate-[12deg] group-hover/logo:scale-110`}
    />
  );
}

/** `iconOnlyOnTiny` drops the name below 400px so a header with a wallet button still fits a 360px phone. */
export function Wordmark({ iconOnlyOnTiny }: { iconOnlyOnTiny?: boolean }) {
  return (
    <span className="group/logo flex items-center gap-2.5">
      <LogoMark className="h-10 w-10" />
      <span className={`font-display text-xl font-extrabold leading-none tracking-tight text-monad-ink ${iconOnlyOnTiny ? "max-[399px]:sr-only" : ""}`}>
        Chog<span className="text-monad-primary">Sweeper</span>
      </span>
    </span>
  );
}
