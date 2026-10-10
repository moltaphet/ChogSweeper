"use client";

import { Check, ChevronDown, Copy, ExternalLink, LogOut, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAccount, useBalance, useConnect, useDisconnect } from "wagmi";
import { monadTestnet } from "@/lib/config";
import { formatMon, shortAddress } from "@/lib/format";

/** Deterministic two-colour avatar so each wallet looks like itself. */
function avatarGradient(address: string) {
  const n = parseInt(address.slice(2, 8), 16);
  const h1 = 240 + (n % 60);
  return `linear-gradient(135deg, hsl(${h1} 85% 68%), hsl(${(h1 + 40) % 360} 80% 55%))`;
}

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address, chainId: monadTestnet.id, query: { enabled: !!address } });
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasProvider, setHasProvider] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setHasProvider(typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum), []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isConnected || !address) {
    return (
      <div className="flex flex-col items-end">
        <button
          type="button"
          className="btn-primary !px-3 !py-2.5 sm:!px-4"
          disabled={isPending || connectors.length === 0 || !hasProvider}
          onClick={() => connectors[0] && connect({ connector: connectors[0], chainId: monadTestnet.id })}
          title={hasProvider ? undefined : "No browser wallet detected. Install one to connect."}
        >
          <Wallet className="h-4 w-4" aria-hidden />
          {isPending ? "Connecting…" : hasProvider ? <span>Connect<span className="hidden sm:inline"> wallet</span></span> : <span><span className="sm:hidden">No wallet</span><span className="hidden sm:inline">No wallet found</span></span>}
        </button>
        {error && <span role="alert" className="absolute top-full mt-1 max-w-[16rem] text-right text-[11px] text-status-dangerInk">{error.message.split("\n")[0]}</span>}
      </div>
    );
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl border border-monad-border bg-white/90 py-1.5 pl-1.5 pr-3 text-sm font-semibold shadow-card transition duration-200 hover:border-monad-primary"
      >
        <span className="h-7 w-7 rounded-lg" style={{ background: avatarGradient(address) }} aria-hidden />
        <span className="font-mono text-[13px]">{shortAddress(address)}</span>
        <ChevronDown className={`h-4 w-4 text-monad-muted transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-monad-border bg-white shadow-lift">
          <div className="border-b border-monad-border/70 bg-monad-bg/60 px-4 py-3">
            <p className="label">Balance</p>
            <p className="mt-0.5 flex items-center gap-1.5 font-display text-lg font-bold">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-coin text-[10px] font-black text-white" aria-hidden>M</span>
              {balance ? formatMon(balance.value, 4) : "…"} <span className="text-sm font-semibold text-coin-ink">MON</span>
            </p>
          </div>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-monad-tint"
            onClick={() => {
              navigator.clipboard?.writeText(address).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)));
            }}
          >
            {copied ? <Check className="h-4 w-4 text-status-active" /> : <Copy className="h-4 w-4 text-monad-muted" />} {copied ? "Copied" : "Copy address"}
          </button>
          <a
            role="menuitem"
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-monad-tint"
            href={`${monadTestnet.blockExplorers.default.url}/address/${address}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="h-4 w-4 text-monad-muted" /> View on explorer
          </a>
          <button role="menuitem" className="flex w-full items-center gap-2.5 border-t border-monad-border/70 px-4 py-2.5 text-left text-sm text-status-dangerInk hover:bg-status-dangerBg" onClick={() => (disconnect(), setOpen(false))}>
            <LogOut className="h-4 w-4" /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
