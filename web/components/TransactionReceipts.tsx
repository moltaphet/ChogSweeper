"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Clipboard, ExternalLink, FileCheck2, X } from "lucide-react";
import type { TransactionReceipt as ChainReceipt } from "viem";
import { formatMon, shortAddress } from "@/lib/format";
import { monadTestnet } from "@/lib/config";

export interface ReceiptNotice {
  title: string;
  summary: string;
  receipt: ChainReceipt;
  relatedTransactions?: { label: string; hash: ChainReceipt["transactionHash"] }[];
}

const ReceiptContext = createContext<((notice: ReceiptNotice) => void) | null>(null);

export function TransactionReceiptsProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<ReceiptNotice | null>(null);
  return (
    <ReceiptContext.Provider value={setNotice}>
      {children}
      {notice && <ReceiptDialog notice={notice} onClose={() => setNotice(null)} />}
    </ReceiptContext.Provider>
  );
}

export function useTransactionReceipts() {
  const showReceipt = useContext(ReceiptContext);
  if (!showReceipt) throw new Error("useTransactionReceipts must be used inside TransactionReceiptsProvider");
  return showReceipt;
}

function ReceiptDialog({ notice, onClose }: { notice: ReceiptNotice; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const { receipt } = notice;
  const hash = receipt.transactionHash;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current!;
    const focusable = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    panel.querySelector<HTMLElement>(focusable)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...panel.querySelectorAll<HTMLElement>(focusable)];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  async function copyHash() {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const gasCost = receipt.effectiveGasPrice === undefined ? null : receipt.gasUsed * receipt.effectiveGasPrice;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-monad-ink/50 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="receipt-title" className="card w-full max-w-xl overflow-hidden rounded-b-none shadow-2xl sm:rounded-card">
        <header className="flex items-start gap-3 border-b border-monad-border px-5 py-4 sm:px-6">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-status-activeBg text-status-activeInk">
            <FileCheck2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Monad Testnet · confirmed on-chain</p>
            <h2 id="receipt-title" className="mt-1 font-display text-lg font-bold">{notice.title}</h2>
            <p className="mt-1 text-sm text-monad-muted">{notice.summary}</p>
          </div>
          <button type="button" className="btn-ghost !px-2.5 !py-2" aria-label="Close transaction receipt" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-5 sm:px-6">
          <div className="rounded-xl border border-status-active/30 bg-status-activeBg px-4 py-3 text-sm text-status-activeInk">
            <p className="flex items-center gap-2 font-semibold"><Check className="h-4 w-4" aria-hidden /> Transaction successful</p>
            <p className="mt-1 text-xs opacity-80">The network included this transaction in block {receipt.blockNumber.toString()}.</p>
          </div>

          <dl className="grid gap-x-5 gap-y-3 rounded-xl border border-monad-border bg-monad-bg/60 p-4 text-sm sm:grid-cols-2">
            <ReceiptField label="Block" value={receipt.blockNumber.toString()} />
            <ReceiptField label="Transaction index" value={receipt.transactionIndex.toString()} />
            <ReceiptField label="Gas used" value={receipt.gasUsed.toLocaleString()} />
            <ReceiptField label="Network fee" value={gasCost === null ? "Unavailable" : `${formatMon(gasCost, 8)} MON`} />
            <ReceiptAddress label="From" address={receipt.from} />
            <ReceiptAddress label="To" address={receipt.to} />
            <ReceiptField label="Events recorded" value={receipt.logs.length.toString()} />
            <ReceiptField label="Network" value={monadTestnet.name} />
          </dl>

          <div className="rounded-xl border border-monad-border px-4 py-3">
            <p className="text-xs font-semibold text-monad-muted">Transaction hash</p>
            <p className="mt-1 break-all font-mono text-xs leading-relaxed text-monad-ink">{hash}</p>
          </div>

          {!!notice.relatedTransactions?.length && (
            <section className="rounded-xl border border-monad-border px-4 py-3">
              <h3 className="text-xs font-semibold text-monad-muted">Other transactions in this step</h3>
              <ul className="mt-2 space-y-2">
                {notice.relatedTransactions.map((transaction) => (
                  <li key={transaction.hash} className="flex min-w-0 items-center justify-between gap-3 text-xs">
                    <span className="shrink-0 text-monad-ink">{transaction.label}</span>
                    <a className="inline-flex min-w-0 items-center gap-1 font-mono text-monad-deep hover:underline" href={`${monadTestnet.blockExplorers.default.url}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">
                      <span className="truncate">{transaction.hash}</span><ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={copyHash}>
              {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
              {copied ? "Copied" : "Copy hash"}
            </button>
            <a className="btn-primary" href={`${monadTestnet.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">
              Open full receipt <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function ReceiptField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-monad-muted">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-xs font-semibold text-monad-ink">{value}</dd>
    </div>
  );
}

function ReceiptAddress({ label, address }: { label: string; address: `0x${string}` | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-monad-muted">{label}</dt>
      {address ? (
        <dd className="mt-0.5">
          <a className="font-mono text-xs font-semibold text-monad-ink hover:text-monad-deep" href={`${monadTestnet.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer" title={address}>
            {shortAddress(address)} <ExternalLink className="inline h-3 w-3" />
          </a>
        </dd>
      ) : <dd className="mt-0.5 text-xs text-monad-muted">Contract creation</dd>}
    </div>
  );
}
