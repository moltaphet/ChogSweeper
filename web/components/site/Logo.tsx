/**
 * Brand mark: a violet squircle with two arrows that pass each other. On hover (or keyboard focus of the link around it) the
 * arrows slide past one another, the same motion as the trade itself.
 */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={`${className} overflow-visible`} role="img" aria-label="ChogSweeper">
      <defs>
        <linearGradient id="lm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8F7BFF" />
          <stop offset="1" stopColor="#5E43F3" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#lm)" />
      <g className="transition-transform duration-500 ease-out group-hover/logo:translate-x-[3px] group-focus-visible/logo:translate-x-[3px]">
        <path d="M10 15h16m0 0-4-4m4 4-4 4" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="transition-transform duration-500 ease-out group-hover/logo:-translate-x-[3px] group-focus-visible/logo:-translate-x-[3px]">
        <path d="M30 25H14m0 0 4-4m-4 4 4 4" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="group/logo flex items-center gap-2.5">
      <LogoMark />
      <span className="font-display text-xl font-extrabold leading-none tracking-tight text-monad-ink">
        Chog<span className="text-monad-primary">Sweeper</span>
      </span>
    </span>
  );
}
