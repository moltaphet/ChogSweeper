import { BadgeCheck, ShieldAlert, Sparkles } from "lucide-react";
import type { Ecosystem } from "@/lib/types";

interface Props {
  verified?: boolean;
  ecosystem?: Ecosystem | null;
  isChog?: boolean;
  /** Show the amber "Unverified" warning instead of rendering nothing for unverified collections. */
  showUnverified?: boolean;
  /** Icon only (for dense chips); the label stays available to screen readers. */
  compact?: boolean;
}

const LABEL: Record<Ecosystem, string> = { chog: "Chog", monad: "Monad" };

/** Verified-collection marker: violet for Chog, green check for other verified Monad collections. */
export function VerifiedBadge({ verified, ecosystem, isChog, showUnverified, compact }: Props) {
  if (isChog || ecosystem === "chog") {
    return (
      <span
        title="Verified Chog collection"
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-monad-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
      >
        <Sparkles className="h-3 w-3" aria-hidden />
        <span className={compact ? "sr-only" : undefined}>Chog</span>
      </span>
    );
  }
  if (verified) {
    const label = ecosystem ? `Verified ${LABEL[ecosystem]}` : "Verified";
    return (
      <span
        title={`${label} collection`}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-status-activeBg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-status-activeInk ring-1 ring-status-active/40"
      >
        <BadgeCheck className="h-3 w-3 text-status-active" aria-hidden />
        <span className={compact ? "sr-only" : undefined}>{label}</span>
      </span>
    );
  }
  if (!showUnverified) return null;
  return (
    <span
      title="This collection is not in the verified registry. Check the contract address before trading."
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-status-warnBg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-status-warn"
    >
      <ShieldAlert className="h-3 w-3" aria-hidden />
      <span className={compact ? "sr-only" : undefined}>Unverified</span>
    </span>
  );
}
