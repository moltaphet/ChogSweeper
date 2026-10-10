"use client";

import { Menu, Rocket, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LAUNCHPAD_PATH } from "@/lib/routes";
import { NAV, type NavKey } from "@/lib/site";
import { Wordmark } from "./site/Logo";
import { NavLinks } from "./site/NavLinks";
import { NetworkSelector } from "./site/NetworkSelector";
import { WalletButton } from "./site/WalletButton";
import { useUnread } from "./UnreadContext";

/** On the landing page: which of these sections is the one currently under the header? */
function useSectionInView(ids: readonly string[], enabled: boolean): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return setCurrent(null);
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
        setCurrent(ids.find((id) => seen.has(id)) ?? null);
      },
      { rootMargin: "-30% 0px -55% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [enabled, ids]);
  return current;
}

const LANDING_SECTIONS = ["how-it-works", "ecosystem"] as const;

/**
 * One navbar for the whole site.
 *   left   brand (home)                          center  Launchpad (unread) / How It Works / Ecosystem / Contract Explorer
 *   right  live network pill + route-aware CTA: "Open Launchpad" on the landing page, the wallet button inside the app
 */
export function Navbar() {
  const pathname = usePathname();
  const inApp = pathname.startsWith(LAUNCHPAD_PATH);
  const { unread } = useUnread();
  const section = useSectionInView(LANDING_SECTIONS, !inApp);
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => setMenu(false), [pathname]);

  const active: NavKey | null = inApp ? "launchpad" : section === "how-it-works" ? "how" : section === "ecosystem" ? "ecosystem" : null;

  return (
    <header className={`sticky top-0 z-40 transition duration-300 ${scrolled || menu || inApp ? "border-b border-monad-border/70 bg-white/75 shadow-[0_8px_30px_-18px_rgba(94,67,243,0.35)] backdrop-blur-xl" : "border-b border-transparent bg-transparent"}`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="ChogSweeper home" className="rounded-xl">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden xl:block">
          <NavLinks items={NAV} active={active} unread={unread} />
        </nav>

        <div className="flex items-center gap-2.5">
          <span className="hidden lg:block"><NetworkSelector /></span>
          {inApp ? (
            <WalletButton />
          ) : (
            <Link href={LAUNCHPAD_PATH} className="btn-primary !px-3 !py-2.5 sm:!px-4">
              <Rocket className="h-4 w-4" aria-hidden /> <span><span className="hidden sm:inline">Open </span>Launchpad</span>
            </Link>
          )}
          <button type="button" className="btn-ghost relative !p-2.5 xl:hidden" aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu} aria-controls="mobile-nav" onClick={() => setMenu((m) => !m)}>
            {menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            {!menu && unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-violet ring-2 ring-white" aria-hidden />}
          </button>
        </div>
      </div>

      {menu && (
        <nav id="mobile-nav" aria-label="Mobile" className="border-t border-monad-border/70 px-4 pb-4 pt-2 xl:hidden">
          <NavLinks items={NAV} active={active} unread={unread} variant="stack" onNavigate={() => setMenu(false)} />
          <div className="mt-3 lg:hidden"><NetworkSelector /></div>
        </nav>
      )}
    </header>
  );
}

/** Shown while the search params resolve, so the header never pops in. */
export function NavbarFallback() {
  return (
    <header className="sticky top-0 z-40 border-b border-transparent">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between px-4 sm:px-6">
        <Wordmark />
        <span className="h-10 w-32 animate-pulse rounded-xl bg-monad-tint" aria-hidden />
      </div>
    </header>
  );
}
