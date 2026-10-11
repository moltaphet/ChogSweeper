"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, Clock, ExternalLink, X } from "lucide-react";
import { useAccount } from "@/lib/useAccount";
import { ZERO_ADDRESS, monadTestnet } from "@/lib/config";
import { formatMon, nftKey, sameAddress, shortAddress } from "@/lib/format";
import { expiryLabel } from "@/lib/time";
import type { SwapRecord, TradeAsset } from "@/lib/types";
import { useTradeActions } from "@/lib/useTradeActions";
import { NftImage } from "./NftImage";
import { StatusBadge } from "./StatusBadge";
import { TradeActions } from "./TradeActions";
import { VerifiedBadge } from "./VerifiedBadge";
import { MonTicker } from "@/components/site/MonTicker";
import { MonadLogo } from "@/components/site/MonadLogo";

const EXPLORER = monadTestnet.blockExplorers.default.url;
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  trade: SwapRecord | null;
  onClose: () => void;
}

export function TradeDetailModal({ trade, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !trade) return null;
  return createPortal(<ModalBody trade={trade} onClose={onClose} />, document.body);
}

function ModalBody({ trade, onClose }: { trade: SwapRecord; onClose: () => void }) {
  const { address } = useAccount();
  const actions = useTradeActions(trade);
  const panelRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Live countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Focus management: move focus in, trap Tab, close on Escape, lock page scroll, restore focus on exit.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current!;
    panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  const isOpenOffer = trade.taker === ZERO_ADDRESS;
  const live = trade.status === "pending" || trade.status === "expired";
  const youAreMaker = sameAddress(trade.maker, address);
  const youAreTaker = !isOpenOffer && sameAddress(trade.taker, address);
  const makerLabel = youAreMaker ? "You give" : "Maker gives";
  const takerLabel = youAreTaker ? "You give" : isOpenOffer ? "Taker gives" : "Taker gives";
  const everyAsset = [...trade.offered, ...trade.wanted];
  const anyUnverified = everyAsset.some((a) => a.verified === false);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div className="absolute inset-0 bg-monad-ink/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-title"
        className="card relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-b-none sm:rounded-b-card"
      >
        {/* header */}
        <header className="flex items-start justify-between gap-4 border-b border-monad-border px-5 py-4 sm:px-6">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="trade-title" className="text-lg font-bold">Trade #{trade.id.toString()}</h2>
              <StatusBadge status={trade.status} />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-monad-muted">
              <Clock className="h-3.5 w-3.5" />
              {live ? expiryLabel(trade.expiry, now) : `Expiry ${new Date(trade.expiry * 1000).toLocaleString()}`}
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2.5 !py-2" aria-label="Close trade details">
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* body */}
        <div className="space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="grid items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
            <Side
              title={makerLabel}
              wallet={trade.maker}
              walletNote={youAreMaker ? "you" : undefined}
              assets={trade.offered}
              mon={trade.offeredMon}
            />
            <ArrowLeftRight className="mx-auto mt-10 hidden h-6 w-6 text-monad-primary md:block" aria-hidden />
            <Side
              title={takerLabel}
              wallet={isOpenOffer ? null : trade.taker}
              walletNote={isOpenOffer ? "open to anyone" : youAreTaker ? "you" : undefined}
              assets={trade.wanted}
              mon={trade.wantedMon}
              emptyLabel="Nothing requested: this is a gift"
            />
          </div>

          {anyUnverified && (
            <p className="rounded-xl bg-status-warnBg px-4 py-3 text-xs text-status-warn">
              One or more collections in this trade are not in the verified registry. Anyone can create a look-alike
              collection, so check the contract address on the explorer before accepting.
            </p>
          )}

          {actions.canAccept && (
            <dl className="rounded-xl border border-monad-border bg-monad-bg/60 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <dt className="font-semibold">You pay</dt>
                <dd className="font-bold text-monad-deep">{actions.totalDue === null ? "…" : actions.totalDue === 0n ? "Nothing" : <>{formatMon(actions.totalDue, 6)} <MonTicker /></>}</dd>
              </div>
              <p className="mt-1 text-xs text-monad-muted">The platform fee was already paid by the maker. You never pay a fee to accept.</p>
            </dl>
          )}

          {trade.feePaid != null && trade.feePaid > 0n && (
            <p className="text-xs text-monad-muted">Platform fee paid by the maker: {formatMon(trade.feePaid, 6)} <MonTicker /></p>
          )}

          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-monad-muted">
            {trade.createdTx && (
              <li><ExplorerLink href={`${EXPLORER}/tx/${trade.createdTx}`}>Creation transaction</ExplorerLink></li>
            )}
            {trade.settledTx && (
              <li><ExplorerLink href={`${EXPLORER}/tx/${trade.settledTx}`}>Settlement transaction</ExplorerLink></li>
            )}
          </ul>
        </div>

        {/* footer */}
        {actions.hasActions && (
          <footer className="border-t border-monad-border bg-white px-5 py-4 sm:px-6">
            <TradeActions trade={trade} layout="stack" />
          </footer>
        )}
      </div>
    </div>
  );
}

function Side(props: {
  title: string;
  wallet: string | null;
  walletNote?: string;
  assets: readonly TradeAsset[];
  mon: bigint;
  emptyLabel?: string;
}) {
  const empty = props.assets.length === 0 && props.mon === 0n;
  return (
    <section className="rounded-2xl border border-monad-border bg-white p-4" aria-label={props.title}>
      <h3 className="text-sm font-bold">{props.title}</h3>
      <p className="mb-3 mt-0.5 text-xs text-monad-muted">
        {props.wallet ? (
          <a className="font-mono hover:text-monad-deep" href={`${EXPLORER}/address/${props.wallet}`} target="_blank" rel="noreferrer">
            {shortAddress(props.wallet)}
          </a>
        ) : null}
        {props.walletNote ? <span>{props.wallet ? " · " : ""}{props.walletNote}</span> : null}
      </p>

      {empty ? (
        <p className="rounded-xl border border-monad-border px-3 py-6 text-center text-xs text-monad-muted">
          {props.emptyLabel ?? "Nothing"}
        </p>
      ) : (
        <div className="space-y-3">
          {props.assets.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
              {props.assets.map((a) => (
                <li key={nftKey(a)}><NftTile asset={a} /></li>
              ))}
            </ul>
          )}
          {props.mon > 0n && (
            <p className="inline-flex items-center gap-1.5 rounded-lg bg-monad-tint px-3 py-1.5 text-sm font-semibold text-monad-deep">
              <MonadLogo className="h-4 w-4" /> {formatMon(props.mon)} <MonTicker />
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function NftTile({ asset }: { asset: TradeAsset }) {
  const known = asset.verified !== undefined; // false when only chain data is available
  const collection = asset.collectionName ?? shortAddress(asset.contract);
  return (
    <div className="overflow-hidden rounded-xl border border-monad-border bg-white">
      <NftImage
        src={asset.image}
        fallbacks={asset.imageFallbacks}
        alt={asset.name ?? `Token ${asset.tokenId}`}
        collectionName={collection}
        tokenId={asset.tokenId}
        className="aspect-square"
      />
      <div className="space-y-1 px-2.5 py-2">
        <p className="truncate text-sm font-semibold" title={asset.name}>{asset.name ?? `#${asset.tokenId}`}</p>
        <p className="flex items-center gap-1.5 text-xs text-monad-muted">
          <span className="rounded bg-monad-tint px-1.5 py-0.5 font-mono font-semibold text-monad-deep">#{asset.tokenId.toString()}</span>
          <span className="truncate" title={asset.contract}>{collection}</span>
        </p>
        {known && <VerifiedBadge verified={asset.verified} ecosystem={asset.ecosystem} isChog={asset.isChog} showUnverified />}
        {asset.traits && asset.traits.length > 0 && (
          <p className="flex flex-wrap gap-1" title={asset.traits.map((t) => `${t.trait_type}: ${t.value}`).join("\n")}>
            {asset.traits.slice(0, 3).map((t) => (
              <span key={t.trait_type + t.value} className="max-w-full truncate rounded-full border border-monad-border px-1.5 py-0.5 text-[10px] text-monad-muted">
                {t.trait_type}: <span className="font-semibold text-monad-ink">{t.value}</span>
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

function ExplorerLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="inline-flex items-center gap-1 hover:text-monad-deep" href={href} target="_blank" rel="noreferrer">
      {children} <ExternalLink className="h-3 w-3" />
    </a>
  );
}
