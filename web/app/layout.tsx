import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Suspense, type ReactNode } from "react";
import { Navbar, NavbarFallback } from "@/components/Navbar";
import { Providers } from "@/components/Providers";
import "./globals.css";

// Self-hosted from npm (@fontsource-variable/*, SIL OFL): no request to Google at build or run time, so the typography
// is identical offline, in CI and for visitors who block third-party font hosts. Latin subset; other scripts use the fallback.
const display = localFont({ src: "../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2", variable: "--font-display", display: "swap", weight: "200 800" });
const body = localFont({ src: "../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2", variable: "--font-body", display: "swap", weight: "300 900" });
const mono = localFont({ src: "../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2", variable: "--font-mono", display: "swap", weight: "100 800" });

export const metadata: Metadata = {
  title: { default: "ChogSweeper: P2P NFT trading on Monad", template: "%s | ChogSweeper" },
  description: "Swap Chog-to-Chog, bundle multi-NFT trades, and balance deals with native MON. Atomic on-chain settlement on Monad.",
};

export const viewport: Viewport = { themeColor: "#D6CBFF" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Providers>
          {/* Soft violet atmosphere behind the top of every page. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[780px] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]" aria-hidden>
            <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-monad-primary/20 blur-3xl" />
            <div className="absolute -right-32 top-10 h-[420px] w-[420px] rounded-full bg-monad-deep/15 blur-3xl" />
          </div>
          {/* useSearchParams (active nav state) needs a Suspense boundary so pages can still be prerendered. */}
          <Suspense fallback={<NavbarFallback />}>
            <Navbar />
          </Suspense>
          {children}
        </Providers>
      </body>
    </html>
  );
}
