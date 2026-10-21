"use client";

import { Check, ExternalLink, Wallet } from "lucide-react";
import { useBalance, useConnect, useSwitchChain } from "wagmi";
import { monadTestnet } from "@/lib/config";
import { formatMon, shortAddress } from "@/lib/format";
import { useAccount } from "@/lib/useAccount";
import { MonTicker } from "../site/MonTicker";
import { TestNfts } from "./TestNfts";

const FAUCET_URL = process.env.NEXT_PUBLIC_FAUCET_URL ?? "https://faucet.monad.xyz";

/** One test onboarding view: connect, fund with test MON, mint replicas, then start trading. */
export function TestFaucet() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect } = useConnect();
  const { switchChain } = useSwitchChain();
  const wrongChain = isConnected && chainId !== monadTestnet.id;
  const { data: mon } = useBalance({ address, chainId: monadTestnet.id, query: { enabled: !!address, refetchInterval: 10_000 } });

  return (
    <div className="space-y-7">
      <header>
        <p className="eyebrow">Monad Testnet only</p>
        <h2 className="h-section mt-1">Get ready to trade</h2>
        <p className="mt-2 max-w-2xl text-sm text-monad-muted">Connect a wallet, get test MON for gas, and mint practice NFTs here. Test assets have no monetary value.</p>
      </header>

      <ol className="grid gap-3 md:grid-cols-2">
        <li className="rounded-2xl border border-monad-border bg-white/70 p-4">
          <div className="flex items-center gap-2 font-display font-bold text-monad-ink">
            <span className={`grid h-7 w-7 place-items-center rounded-full text-sm ${isConnected && !wrongChain ? "bg-status-active text-white" : "bg-monad-tint text-monad-deep"}`}>
              {isConnected && !wrongChain ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : "1"}
            </span>
            Connect on Monad Testnet
          </div>
          <div className="mt-3">
            {!isConnected ? (
              <button type="button" className="btn-primary !px-4 !py-2" onClick={() => connectors[0] && connect({ connector: connectors[0], chainId: monadTestnet.id })}>
                <Wallet className="h-4 w-4" aria-hidden /> Connect wallet
              </button>
            ) : wrongChain ? (
              <button type="button" className="btn-primary !px-4 !py-2" onClick={() => switchChain({ chainId: monadTestnet.id })}>Switch to Monad Testnet</button>
            ) : (
              <p className="text-sm text-monad-muted">Connected as <span className="font-mono font-semibold text-monad-ink">{shortAddress(address!)}</span>.</p>
            )}
          </div>
        </li>

        <li className="rounded-2xl border border-monad-border bg-white/70 p-4">
          <div className="font-display font-bold text-monad-ink"><span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-monad-tint text-sm text-monad-deep">2</span>Get test MON for gas</div>
          <p className="mt-3 text-sm text-monad-muted">
            Balance: <strong className="text-monad-ink">{!isConnected ? "Connect wallet to check" : mon ? formatMon(mon.value, 4) : "Checking…"}</strong>
            {isConnected && <> <MonTicker />. Test MON has no real value.</>}
          </p>
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className="btn-ghost mt-3 inline-flex !px-3 !py-2 !text-xs">
            Open Monad faucet <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </li>
      </ol>

      <div className="border-t border-monad-border/70 pt-6">
        <TestNfts showIntro={false} />
      </div>
    </div>
  );
}
