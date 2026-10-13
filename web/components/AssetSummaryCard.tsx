import { BadgeCheck } from "lucide-react";
import { formatMon, nftKey, shortAddress } from "@/lib/format";
import type { NFTItem, NFTRef } from "@/lib/types";
import { NftImage } from "./NftImage";
import { MonTicker } from "@/components/site/MonTicker";
import { MonadLogo } from "@/components/site/MonadLogo";

interface Props {
  title: string;
  /** Tokens on this side. Items without metadata fall back to "contract #id". */
  nfts: readonly (NFTRef & Partial<NFTItem>)[];
  monWei: bigint;
  /** Optional counterparty line, e.g. a wallet address. */
  subtitle?: string;
  compact?: boolean;
}

export function AssetSummaryCard({ title, nfts, monWei, subtitle, compact }: Props) {
  const empty = nfts.length === 0 && monWei === 0n;
  return (
    <div className={`rounded-2xl border border-monad-border bg-monad-bg/60 ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-monad-ink">{title}</h4>
        {subtitle && <span className="truncate text-xs text-monad-muted">{subtitle}</span>}
      </div>

      {empty ? (
        <p className="mt-2 text-xs text-monad-muted">Nothing selected</p>
      ) : (
        <div className="mt-2 space-y-2">
          {nfts.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {nfts.map((n) => (
                <li
                  key={nftKey(n)}
                  title={n.name ?? `${shortAddress(n.contract)} #${n.tokenId}`}
                  className="flex items-center gap-1.5 rounded-lg border border-monad-border bg-white py-1 pl-1 pr-2 text-xs text-monad-ink"
                >
                  <NftImage src={n.image} fallbacks={n.imageFallbacks} alt="" collectionName={n.collectionName ?? ""} tokenId={n.tokenId} compact className="h-6 w-6 shrink-0 rounded" />
                  <span className="max-w-[8rem] truncate">{n.name ?? `#${n.tokenId}`}</span>
                  {n.verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-status-active" aria-label="Verified collection" />}
                </li>
              ))}
            </ul>
          )}
          {monWei > 0n && (
            <p className="inline-flex items-center gap-1.5 rounded-lg bg-monad-tint px-2.5 py-1 text-sm font-semibold text-monad-deep">
              <MonadLogo className="h-4 w-4" /> {formatMon(monWei)} <MonTicker />
            </p>
          )}
        </div>
      )}
    </div>
  );
}
