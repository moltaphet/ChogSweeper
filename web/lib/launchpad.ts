import { Activity, BadgeCheck, Clock, Droplets, FlaskConical, Globe, Inbox, Plus, Search, type LucideIcon } from "lucide-react";
import type { SwapTab, TradeMode } from "./routes";

/** One tool of the Launchpad. `tab` is the workspace view it opens; `mode` preselects Direct or Public for a new trade. */
export interface LaunchpadTool {
  tab: Exclude<SwapTab, "overview">;
  mode?: TradeMode;
  label: string;
  /** Short name on the tab row. */
  tabLabel: string;
  blurb: string;
  icon: LucideIcon;
}

/** Every tool the app offers, in the order they appear on the landing page, the overview grid and the tab row. */
export const TOOLS: readonly LaunchpadTool[] = [
  { tab: "new", label: "New swap", tabLabel: "New Swap", blurb: "Bundle up to 10 NFTs and MON, name who can accept, and escrow the deal.", icon: Plus },
  { tab: "requests", label: "Requests", tabLabel: "Requests", blurb: "Offers sent to you and offers you created. Accept, decline or cancel here.", icon: Inbox },
  { tab: "history", label: "History", tabLabel: "History", blurb: "Everything you completed, cancelled or declined, with transaction links.", icon: Clock },
  { tab: "public", label: "Public trades", tabLabel: "Public Trades", blurb: "Open offers anyone can accept. First collector to accept wins.", icon: Globe },
  { tab: "collections", label: "Verified collections", tabLabel: "Collections", blurb: "The Chog and Monad collections in the registry, with contract links.", icon: BadgeCheck },
  { tab: "activity", label: "Live activity", tabLabel: "Activity", blurb: "Marketplace totals and the latest trades, straight from the indexer.", icon: Activity },
  { tab: "lookup", label: "Token lookup", tabLabel: "Lookup", blurb: "Check any ERC-721 by contract and token id before you trade it.", icon: Search },
  { tab: "faucet", label: "Test faucet", tabLabel: "Test Faucet", blurb: "Testnet only: get test MON, mint free test NFTs and try a swap in a few clicks.", icon: Droplets },
  { tab: "test-nfts", label: "Get test NFTs", tabLabel: "Test NFTs", blurb: "Mint test replicas of r3tards, skrumpeys and The Bobs to practice trading on Monad Testnet.", icon: FlaskConical },
];
