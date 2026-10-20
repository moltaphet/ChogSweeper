"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, FlaskConical, Loader2, Plus, Wallet } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { type Address, parseAbi } from "viem";
import { useBalance, useConnect, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { monadTestnet, SWEEPER_ADDRESS } from "@/lib/config";
import { confirmTx } from "@/lib/confirm";
import { formatMon, shortAddress } from "@/lib/format";
import { useAccount } from "@/lib/useAccount";
import { DEFAULT_TEST_MINT_COUNT, TEST_MINT_COLLECTIONS } from "@/lib/testCollections";
import { MonTicker } from "../site/MonTicker";
import { useHub } from "../HubContext";

const FAUCET_URL = process.env.NEXT_PUBLIC_FAUCET_URL ?? "https://faucet.monad.xyz";
const MINT_COUNT = BigInt(DEFAULT_TEST_MINT_COUNT);

const abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function MAX_BATCH() view returns (uint256)",
  "function isVerified(address collection) view returns (bool)",
  "function mintBatch(address to, uint256 count) returns (uint256)",
]);

/**
 * Everything a reviewer needs to try the app on the testnet without any command line: connect, get test MON from the faucet,
 * mint free test NFTs and head to a swap. Only the four configured practice collections are shown; minting also requires a
 * valid batch limit and live escrow verification, so the real Chog collection never gets a mint button.
 */
export function TestFaucet() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect } = useConnect();
  const { switchChain } = useSwitchChain();
  const { setTab } = useHub();
  const wrongChain = isConnected && chainId !== monadTestnet.id;

  const { data: mon } = useBalance({ address, chainId: monadTestnet.id, query: { enabled: !!address, refetchInterval: 10_000 } });

  const sweeperAddress = SWEEPER_ADDRESS;
  const collections = TEST_MINT_COLLECTIONS.filter((c): c is (typeof TEST_MINT_COLLECTIONS)[number] & { address: Address } => !!c.address);
  const reads = useReadContracts({
    allowFailure: true,
    contracts: collections.flatMap((c) => [
      { address: c.address, abi, functionName: "balanceOf" as const, args: [address ?? "0x0000000000000000000000000000000000000000"] as const, chainId: monadTestnet.id },
      { address: c.address, abi, functionName: "MAX_BATCH" as const, chainId: monadTestnet.id },
    ]),
    query: { enabled: collections.length > 0, refetchInterval: 10_000 },
  });
  const verificationReads = useReadContracts({
    allowFailure: true,
    contracts: sweeperAddress ? collections.map((c) => ({ address: sweeperAddress, abi, functionName: "isVerified" as const, args: [c.address] as const, chainId: monadTestnet.id })) : [],
    query: { enabled: !!sweeperAddress && collections.length > 0, refetchInterval: 10_000 },
  });
  const rows = TEST_MINT_COLLECTIONS.map((collection) => {
    const i = collections.findIndex((c) => c.slug === collection.slug);
    const [b, m] = i < 0 ? [] : [reads.data?.[i * 2], reads.data?.[i * 2 + 1]];
    const v = i < 0 ? undefined : verificationReads.data?.[i];
    return {
      ...collection,
      balance: b?.status === "success" ? (b.result as bigint) : null,
      balanceReadComplete: !!b,
      maxBatch: m?.status === "success" ? (m.result as bigint) : null,
      batchReadComplete: !!m,
      verified: v?.status === "success" ? v.result === true : null,
      verificationReadComplete: !!v || !sweeperAddress,
    };
  });

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
            Your balance: <strong className="text-monad-ink">{!isConnected ? "Connect wallet to see balance" : mon ? formatMon(mon.value, 4) : "Checking balance…"}</strong>{isConnected && <> <MonTicker />. A swap costs well under 0.1 MON; 1 MON is plenty.</>}
          </p>
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className="btn-ghost inline-flex">
            Open the Monad faucet <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </Step>

        <Step n={3} title={`Mint test NFTs (${MINT_COUNT} per click)`} done={rows.some((r) => (r.balance ?? 0n) > 0n)}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <p className="max-w-xl text-sm text-monad-muted">Choose one of the four test collections enabled for trading. Each click mints five free NFTs; use Test NFTs to choose a different amount.</p>
            <button type="button" className="btn-ghost !px-3 !py-2 !text-xs" onClick={() => setTab("test-nfts")}>
              <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Custom mint
            </button>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {rows.map((r) => (
              <MintRow key={r.slug} row={r} account={address} connected={isConnected} wrongChain={wrongChain} onMinted={() => reads.refetch()} />
            ))}
          </ul>
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

function MintRow({ row, account, connected, wrongChain, onMinted }: { row: { slug: string; name: string; address: Address | null; preview: string; balance: bigint | null; balanceReadComplete: boolean; maxBatch: bigint | null; batchReadComplete: boolean; verified: boolean | null; verificationReadComplete: boolean }; account: Address | undefined; connected: boolean; wrongChain: boolean; onMinted: () => void }) {
  const client = usePublicClient({ chainId: monadTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mint() {
    if (!account || wrongChain || !row.address || !client || !SWEEPER_ADDRESS) return;
    setBusy(true);
    setError(null);
    try {
      const verified = await client.readContract({ address: SWEEPER_ADDRESS, abi, functionName: "isVerified", args: [row.address] });
      if (!verified) throw new Error("This test collection is not enabled for trading yet.");
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

  const canMint = !!row.address && connected && !wrongChain && !!account && row.maxBatch !== null && row.maxBatch >= MINT_COUNT && row.verified === true && !busy;
  const mintLabel = (() => {
    if (!row.address) return "Deployment pending";
    if (!connected) return "Connect wallet to mint";
    if (wrongChain) return "Switch to Monad Testnet";
    if (busy) return "Minting…";
    if (row.maxBatch === null) return row.batchReadComplete ? "Mint unavailable" : "Checking collection…";
    if (row.verified === null) return row.verificationReadComplete ? "Verification unavailable" : "Checking verification…";
    if (!row.verified) return "Not enabled for trading";
    if (row.maxBatch < MINT_COUNT) return "Mint unavailable";
    return `Mint ${MINT_COUNT.toString()}`;
  })();
  const balanceLabel = (() => {
    if (!connected) return "Connect wallet to see balance";
    if (wrongChain) return "Switch to Monad Testnet to see balance";
    if (row.balance !== null) return `You own ${row.balance.toString()}`;
    return row.balanceReadComplete ? "Balance unavailable" : "Checking balance…";
  })();

  return (
    <li className="rounded-xl border border-monad-border bg-monad-surface/80 p-3 sm:p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-monad-tint/70 p-1 sm:h-20 sm:w-20">
          <Image src={row.preview} alt="" aria-hidden="true" width={80} height={80} className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-monad-ink">{row.name}</p>
          <p className="mt-1 text-xs text-monad-muted">{balanceLabel}</p>
        </div>
      </div>
      <button type="button" className="btn-primary mt-3 w-full !px-3 !py-2 !text-sm" disabled={!canMint} onClick={mint}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} {mintLabel}
      </button>
      {error && <p className="mt-2 text-xs text-status-dangerInk" role="alert">{error}</p>}
    </li>
  );
}
