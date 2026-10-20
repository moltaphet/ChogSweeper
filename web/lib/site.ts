import { monadTestnet, SWEEPER_ADDRESS } from "./config";
import { HOW_IT_WORKS_HREF, launchpadHref } from "./routes";

/** Outbound links. Anything not verified is configured via env instead of guessed; an unset link renders as "Soon". */
export const LINKS = {
  monad: "https://www.monad.xyz",
  monadDocs: "https://docs.monad.xyz",
  chogDiscord: process.env.NEXT_PUBLIC_CHOG_DISCORD_URL ?? null,
  chogX: process.env.NEXT_PUBLIC_CHOG_X_URL ?? null,
  github: process.env.NEXT_PUBLIC_GITHUB_URL ?? null,
  explorer: monadTestnet.blockExplorers.default.url,
  contract: SWEEPER_ADDRESS ? `${monadTestnet.blockExplorers.default.url}/address/${SWEEPER_ADDRESS}` : null,
} as const;

export type NavKey = "launchpad" | "public-trades" | "how" | "ecosystem" | "contract";

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  /** Opens a different site (a new tab). */
  external?: boolean;
  /** Carries the unread-requests counter. */
  badge?: boolean;
  /** Shown as a tooltip when it helps explain where the link goes. */
  title?: string;
}

/** The navbar, same on every route. Every tool lives in the Launchpad (its badge counts unread requests). "Contract Explorer" points at the deployed contract once there is one, otherwise at the explorer home. */
export const NAV: readonly NavItem[] = [
  { key: "launchpad", label: "Launchpad", href: launchpadHref(), badge: true },
  { key: "public-trades", label: "Public Trades", href: launchpadHref("public"), title: "Browse open trades anyone can accept" },
  { key: "how", label: "How It Works", href: HOW_IT_WORKS_HREF },
  { key: "ecosystem", label: "Ecosystem", href: "/#ecosystem" },
  {
    key: "contract",
    label: "Contract Explorer",
    href: LINKS.contract ?? LINKS.explorer,
    external: true,
    title: LINKS.contract ? "View the ChogSweeper contract on the Monad Testnet explorer" : "The contract is not deployed yet. This opens the Monad Testnet explorer.",
  },
];

/** Footer shortcuts. */
export const FOOTER_NAV: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Launchpad", href: launchpadHref() },
  { label: "New Swap", href: launchpadHref("new") },
  { label: "Public Trades", href: launchpadHref("public") },
  { label: "Requests", href: launchpadHref("requests") },
  { label: "How It Works", href: HOW_IT_WORKS_HREF },
  { label: "Ecosystem", href: "/#ecosystem" },
];
