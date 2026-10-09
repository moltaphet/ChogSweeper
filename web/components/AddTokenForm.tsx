"use client";

import { AlertCircle, CheckCircle2, ChevronDown, Loader2, Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { AddTokenResult } from "@/lib/useWalletNFTs";
import type { NFTItem } from "@/lib/types";
import { NftImage } from "./NftImage";
import { VerifiedBadge } from "./VerifiedBadge";

interface Props {
  onAdd: (contract: string, tokenId: string) => Promise<AddTokenResult>;
  /** Called with the token after a successful add, e.g. to select it right away. */
  onAdded?: (item: NFTItem) => void;
  disabled?: boolean;
  /** Shown when `disabled`, explaining what is needed first. */
  disabledHint?: string;
  /** Whose wallet the token must be in, for the helper text. */
  ownerNoun?: string;
  /** Replaces the default helper sentence (e.g. when no ownership check applies). */
  helpText?: string;
  /** Increment to expand the form from outside (an empty-state button). */
  forceOpen?: number;
  title?: string;
}

/** For tokens the discovery missed (unindexed collection, non-enumerable contract, fresh mint). */
export function AddTokenForm({ onAdd, onAdded, disabled, disabledHint, ownerNoun = "your wallet", helpText, forceOpen, title }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const [contract, setContract] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<NFTItem | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setAdded(null);
    const res = await onAdd(contract, tokenId);
    setBusy(false);
    if (res.ok) {
      setAdded(res.item);
      setTokenId("");
      onAdded?.(res.item);
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-monad-border bg-monad-bg/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-monad-deep"
      >
        <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> {title ?? "Can’t see an NFT? Add it by contract + token ID"}</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <form id={id} onSubmit={submit} className="space-y-3 border-t border-monad-border px-3 py-3">
          {disabled && disabledHint && <p className="text-xs text-monad-muted">{disabledHint}</p>}
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
            <div>
              <label className="label" htmlFor={`${id}-c`}>Contract address</label>
              <input id={`${id}-c`} className="input mt-1 font-mono" placeholder="0x…" value={contract} spellCheck={false} disabled={disabled}
                onChange={(e) => setContract(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="label" htmlFor={`${id}-t`}>Token ID</label>
              <input id={`${id}-t`} className="input mt-1 font-mono" placeholder="123" inputMode="numeric" value={tokenId} disabled={disabled}
                onChange={(e) => setTokenId(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <p className="text-xs text-monad-muted">{helpText ?? `The token must be in ${ownerNoun}. We check ownership on-chain before adding it.`}</p>

          <button type="submit" className="btn-primary !py-2" disabled={disabled || busy || !contract.trim() || !tokenId.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {busy ? "Looking up…" : "Add NFT"}
          </button>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-status-dangerBg px-3 py-2 text-xs text-status-dangerInk">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}
          {added && (
            <div role="status" className="flex items-center gap-3 rounded-lg bg-status-activeBg px-3 py-2 text-xs text-status-activeInk">
              <NftImage src={added.image} fallbacks={added.imageFallbacks} alt="" collectionName={added.collectionName} tokenId={added.tokenId} compact className="h-10 w-10 shrink-0 rounded-lg" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-3.5 w-3.5" /> Added {added.name}</span>
                <span className="mt-0.5 block truncate">{added.collectionName} · #{added.tokenId.toString()}</span>
              </span>
              <VerifiedBadge verified={added.verified} ecosystem={added.ecosystem} isChog={added.isChog} showUnverified />
            </div>
          )}
        </form>
      )}
    </div>
  );
}
