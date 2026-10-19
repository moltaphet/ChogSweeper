"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, FlaskConical, Loader2, Plus, Wallet } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import { type Address, parseAbi } from "viem";
import { useBalance, useConnect, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { CHOG_COLLECTION, DEFAULT_COLLECTIONS, monadTestnet } from "@/lib/config";
import { confirmTx } from "@/lib/confirm";
import { formatMon, shortAddress } from "@/lib/format";
import { useAccount } from "@/lib/useAccount";
import { MonTicker } from "../site/MonTicker";
import { useHub } from "../HubContext";
import { TEST_COLLECTIONS, testArtwork } from "@/lib/testCollections";

const FAUCET_URL = process.env.NEXT_PUBLIC_FAUCET_URL ?? "https://faucet.monad.xyz";
const MINT_COUNT = 5n;

const abi = parseAbi([
  "function name() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function MAX_BATCH() view returns (uint256)",
  "function mintBatch(address to, uint256 count) returns (uint256)",
]);

/**
 * Everything a reviewer needs to try the app on the testnet without any command line: connect, get test MON from the faucet,
 * mint free test NFTs (the mock collections allow anyone to mint) and head to a swap. A collection is offered here only if it
 * has the mock's `MAX_BATCH()`, so the real Chog collection never shows a mint button.
 */
export function TestFaucet() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect } = useConnect();
  const { switchChain } = useSwitchChain();
  const { setTab } = useHub();
  const wrongChain = isConnected && chainId !== monadTestnet.id;

  const { data: mon } = useBalance({ address, chainId: monadTestnet.id, query: { enabled: !!address, refetchInterval: 10_000 } });

  const collections = useMemo(() => [...new Set([CHOG_COLLECTION, ...DEFAULT_COLLECTIONS].filter((a): a is Address => !!a).map((a) => a.toLowerCase()))] as Address[], []);
  const reads = useReadContracts({
    allowFailure: true,
    contracts: collections.flatMap((c) => [
      { address: c, abi, functionName: "name" as const, chainId: monadTestnet.id },
      { address: c, abi, functionName: "balanceOf" as const, args: [address ?? "0x0000000000000000000000000000000000000000"] as const, chainId: monadTestnet.id },
      { address: c, abi, functionName: "MAX_BATCH" as const, chainId: monadTestnet.id },
    ]),
    query: { enabled: collections.length > 0, refetchInterval: 10_000 },
  });
  const rows = collections.map((c, i) => {
    const [n, b, m] = [reads.data?.[i * 3], reads.data?.[i * 3 + 1], reads.data?.[i * 3 + 2]];
    return { address: c, name: n?.status === "success" ? (n.result as string) : shortAddress(c), balance: b?.status === "success" ? (b.result as bigint) : null, mintable: m?.status === "success" };
  }).filter((r) => r.mintable);

  const hasMon = (mon?.value ?? 0n) > 0n;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Testnet only</p>
        <h2 className="h-section mt-1">Test faucet</h2>
        <p className="mt-2 max-w-xl text-sm text-monad-muted">Everything you need to try ChogSweeper in a few clicks: connect, get test MON, mint free test NFTs, then make a swap. Nothing here has any real value.</p>
      </div>

      <ol className="space-y-4">
        <Step n={1} title="Connect a wallet on Monad Testnet" done={isConnected && !wrongChain}>
          {!isConnected ? (
            <button type="button" className="btn-primary !px-4 !py-2" onClick={() => connectors[0] && connect({ connector: connectors[0], chainId: monadTestnet.id })}>
              <Wallet className="h-4 w-4" aria-hidden /> Connect wallet
            </button>
          ) : wrongChain ? (
            <button type="button" className="btn-primary !px-4 !py-2" onClick={() => switchChain({ chainId: monadTestnet.id })}>Switch to Monad Testnet</button>
          ) : (
            <p className="text-sm text-monad-muted">Connected as <span className="font-mono font-semibold text-monad-ink">{shortAddress(address!)}</span>.</p>
          )}
        </Step>

        <Step n={2} title="Get test MON (for gas and the platform fee)" done={hasMon}>
          <p className="mb-3 text-sm text-monad-muted">
            Your balance: <strong className="text-monad-ink">{mon ? formatMon(mon.value, 4) : "…"}</strong> <MonTicker />. A swap costs well under 0.1 MON; 1 MON is plenty.
          </p>
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className="btn-ghost inline-flex">
            Open the Monad faucet <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </Step>

        <Step n={3} title={`Mint free test NFTs (${MINT_COUNT} per click)`} done={rows.some((r) => (r.balance ?? 0n) > 0n)}>
          <section className="mb-5 rounded-xl border border-monad-border bg-monad-surface/60 p-3 sm:p-4" aria-labelledby="artwork-preview-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 id="artwork-preview-title" className="text-sm font-bold text-monad-ink">New collection artwork</h4>
                  <span className="rounded-full bg-monad-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-monad-deep">Preview</span>
                </div>
                <p className="mt-1 text-xs text-monad-muted">All 30 supplied images. Claiming these collections will be enabled after their testnet contracts are deployed.</p>
              </div>
              <button type="button" className="btn-ghost !px-3 !py-2 !text-xs" onClick={() => setTab("test-nfts")}>
                <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Open Test NFTs
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {TEST_COLLECTIONS.map((collection) => (
                <article key={collection.slug} className="rounded-lg border border-monad-border bg-monad-surface/70 p-2.5">
                  <h5 className="mb-2 truncate text-xs font-semibold text-monad-ink">{collection.name}</h5>
                  <div className="grid grid-cols-5 gap-1.5">
                    {Array.from({ length: 10 }, (_, index) => (
                      <Image
                        key={index}
                        src={testArtwork(collection.slug, index + 1)}
                        alt=""
                        aria-hidden="true"
                        width={72}
                        height={72}
                        className="aspect-square w-full rounded-md object-cover"
                      />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
          {rows.length === 0 ? (
            <p className="text-sm text-monad-muted">{reads.isLoading ? "Loading collections…" : "No mintable test collections are configured on this deployment."}</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {rows.map((r) => (
                <MintRow key={r.address} row={r} account={isConnected && !wrongChain ? address : undefined} onMinted={() => reads.refetch()} />
              ))}
            </ul>
          )}
        </Step>

        <Step n={4} title="Make a swap" done={false}>
          <p className="mb-3 text-sm text-monad-muted">
            To try the whole flow with one person: create a <strong>Direct swap</strong> to a second account of your wallet, switch accounts and accept it under Requests. Or post a <strong>Public trade</strong> and accept it from the second account. Your NFTs come back if you cancel or the other side declines.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary !px-4 !py-2" onClick={() => setTab("new")}>
              <Plus className="h-4 w-4" aria-hidden /> New swap
            </button>
            <button type="button" className="btn-ghost" onClick={() => setTab("public")}>Browse public trades</button>
          </div>
        </Step>
      </ol>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-4 rounded-2xl border border-monad-border bg-white/70 p-4 sm:p-5">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-status-active text-white" : "bg-monad-tint text-monad-deep"}`} aria-hidden>
        {done ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="mb-2 font-display text-base font-bold text-monad-ink">{title}</h3>
        {children}
      </div>
    </li>
  );
}

function MintRow({ row, account, onMinted }: { row: { address: Address; name: string; balance: bigint | null }; account: Address | undefined; onMinted: () => void }) {
  const client = usePublicClient({ chainId: monadTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mint() {
    if (!account || !client) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({ address: row.address, abi, functionName: "mintBatch", args: [account, MINT_COUNT], chainId: monadTestnet.id });
      await confirmTx(client, hash);
      onMinted();
      await qc.invalidateQueries();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/reject|denied/i.test(msg) ? "You rejected the request in your wallet." : /insufficient funds/i.test(msg) ? "Not enough MON for gas: use the faucet first." : "The mint did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-monad-border bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-monad-ink">{row.name}</p>
          <p className="text-xs text-monad-muted">You own {row.balance === null ? "…" : row.balance.toString()}</p>
        </div>
        <button type="button" className="btn-primary !px-3 !py-1.5 !text-sm" disabled={!account || busy} onClick={mint} title={account ? undefined : "Connect your wallet on Monad Testnet first"}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Mint {MINT_COUNT.toString()}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-status-dangerInk" role="alert">{error}</p>}
    </li>
  );
}
