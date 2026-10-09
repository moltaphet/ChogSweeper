"use client";

import { Check, ChevronDown, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { monadTestnet } from "@/lib/config";
import { LiveDot, useLiveLook } from "./LiveDot";

const NETWORKS = [
  { id: monadTestnet.id as number, name: monadTestnet.name, available: true },
  // ChogSweeper is only deployed on testnet; listed so the roadmap is visible, but not selectable.
  { id: 143, name: "Monad Mainnet", available: false },
] as const;

/**
 * Shows the network the app works on. Opens a small menu: Monad Testnet (active) and Monad Mainnet (not deployed yet). If the
 * connected wallet is on another chain the pill turns amber and the menu offers a one-click switch.
 */
export function NetworkSelector() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const wrong = isConnected && chainId !== monadTestnet.id;
  const look = useLiveLook();

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

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={wrong ? "Your wallet is on another network" : (look?.text ?? "Checking network status…")}
        className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition duration-200 ${
          wrong ? "border-status-warn/40 bg-status-warnBg text-status-warn hover:brightness-95" : "border-monad-border bg-white/80 text-monad-ink backdrop-blur hover:border-monad-primary"
        }`}
      >
        {wrong ? <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> : <LiveDot />}
        {wrong ? "Wrong network" : monadTestnet.name}
        {!wrong && <span className="sr-only">{look ? `: ${look.text}` : ": checking status"}</span>}
        <ChevronDown className={`h-3.5 w-3.5 opacity-60 transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-monad-border bg-white p-1.5 shadow-lift">
          <p className="label px-2.5 pb-1 pt-1.5">Network</p>
          {NETWORKS.map((n) => {
            const active = n.available && !wrong;
            return (
              <button
                key={n.id}
                role="menuitem"
                disabled={!n.available || isPending}
                onClick={() => {
                  if (n.available && wrong) switchChain({ chainId: n.id });
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition enabled:hover:bg-monad-tint disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex items-center gap-2 font-semibold">
                  <span className={`h-2 w-2 rounded-full ${n.available ? "bg-monad-primary" : "bg-monad-border"}`} aria-hidden /> {n.name}
                </span>
                {active ? <Check className="h-4 w-4 text-status-active" aria-label="Connected" /> : n.available ? <span className="text-xs font-semibold text-status-warn">{isPending ? "Switching…" : "Switch"}</span> : <span className="text-[11px] text-monad-muted">Soon</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
