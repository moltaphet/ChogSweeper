"use client";

import { AlertTriangle, Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { nftKey } from "@/lib/format";
import type { NFTItem } from "@/lib/types";
import { NftImage } from "./NftImage";
import { VerifiedBadge } from "./VerifiedBadge";

interface Props {
  items: readonly NFTItem[];
  /** Keys (see `nftKey`) of the selected tokens. */
  selected: ReadonlySet<string>;
  onToggle: (item: NFTItem) => void;
  /** Selection is capped; unselected cards are disabled once the cap is reached. */
  max: number;
  loading?: boolean;
  disabled?: boolean;
  emptyMessage: string;
  /** Richer empty state (illustration + action); replaces `emptyMessage` when given. */
  emptyContent?: ReactNode;
  /** Lets users remove tokens they added by hand. */
  onRemove?: (item: NFTItem) => void;
}

const MAX_TRAIT_CHIPS = 2;

export function NFTSelectorGrid({ items, selected, onToggle, max, loading, disabled, emptyMessage, emptyContent, onRemove }: Props) {
  if (loading) return <GridSkeleton />;
  if (items.length === 0) {
    if (emptyContent) return <>{emptyContent}</>;
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-monad-border px-6 text-center text-sm text-monad-muted">
        {emptyMessage}
      </div>
    );
  }

  const full = selected.size >= max;
  return (
    <ul className="grid max-h-[26rem] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3" role="listbox" aria-multiselectable="true">
      {items.map((item) => {
        const key = nftKey(item);
        const isSelected = selected.has(key);
        const blocked = disabled || (!isSelected && full);
        const traits = item.traits.slice(0, MAX_TRAIT_CHIPS);
        const moreTraits = item.traits.length - traits.length;
        return (
          <li key={key} className="relative">
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              disabled={blocked}
              onClick={() => onToggle(item)}
              className={[
                "group relative w-full overflow-hidden rounded-2xl border bg-white text-left transition",
                isSelected
                  ? "border-monad-primary ring-2 ring-monad-primary/40 shadow-lift"
                  : "border-monad-border hover:border-monad-primary hover:shadow-card",
                blocked && !isSelected ? "cursor-not-allowed opacity-50" : "",
              ].join(" ")}
            >
              <div className="relative">
                <NftImage
                  src={item.image}
                  fallbacks={item.imageFallbacks}
                  alt={item.name}
                  collectionName={item.collectionName}
                  tokenId={item.tokenId}
                  className="aspect-square"
                />
                {(item.isChog || item.verified) && (
                  <span className="absolute left-2 top-2">
                    <VerifiedBadge verified={item.verified} ecosystem={item.ecosystem} isChog={item.isChog} />
                  </span>
                )}
                {isSelected && (
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-monad-deep text-white shadow">
                    <Check className="h-4 w-4" strokeWidth={3} aria-label="Selected" />
                  </span>
                )}
              </div>

              <div className="space-y-1 px-3 py-2">
                <p className="truncate text-sm font-semibold text-monad-ink" title={item.name}>{item.name}</p>
                <p className="flex items-center gap-1.5 text-xs text-monad-muted">
                  <span className="rounded bg-monad-tint px-1.5 py-0.5 font-mono font-semibold text-monad-deep">#{item.tokenId.toString()}</span>
                  <span className="truncate" title={item.collectionName}>{item.collectionName}</span>
                </p>
                {traits.length > 0 && (
                  <p className="flex flex-wrap gap-1" title={item.traits.map((t) => `${t.trait_type}: ${t.value}`).join("\n")}>
                    {traits.map((t) => (
                      <span key={t.trait_type + t.value} className="max-w-full truncate rounded-full border border-monad-border px-1.5 py-0.5 text-[10px] text-monad-muted">
                        {t.trait_type}: <span className="font-semibold text-monad-ink">{t.value}</span>
                      </span>
                    ))}
                    {moreTraits > 0 && <span className="rounded-full border border-monad-border px-1.5 py-0.5 text-[10px] text-monad-muted">+{moreTraits}</span>}
                  </p>
                )}
                {item.meta === "unresolved" && (
                  <p className="flex items-center gap-1 text-[10px] font-medium text-status-warn">
                    <AlertTriangle className="h-3 w-3" aria-hidden /> Metadata unavailable
                  </p>
                )}
              </div>
            </button>
            {item.custom && onRemove && (
              <button
                type="button"
                onClick={() => onRemove(item)}
                aria-label={`Remove ${item.name} from this list`}
                title="Remove (added manually)"
                className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-full border border-monad-border bg-white text-monad-muted shadow-sm transition hover:border-status-danger hover:text-status-dangerInk"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Same footprint as the real grid so the layout does not jump when data arrives. */
export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid max-h-[26rem] grid-cols-2 gap-3 overflow-hidden sm:grid-cols-3" aria-busy="true" aria-label="Loading NFTs">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="animate-pulse overflow-hidden rounded-2xl border border-monad-border bg-white">
          <div className="aspect-square bg-monad-tint" />
          <div className="space-y-2 px-3 py-2.5">
            <div className="h-3.5 w-3/4 rounded bg-monad-tint" />
            <div className="h-3 w-1/2 rounded bg-monad-tint" />
          </div>
        </li>
      ))}
    </ul>
  );
}
