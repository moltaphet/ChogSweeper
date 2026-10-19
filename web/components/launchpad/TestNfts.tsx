"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, FlaskConical, Loader2 } from "lucide-react";
import { usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "@/lib/useAccount";
import { monadTestnet, SWEEPER_ADDRESS } from "@/lib/config";
import { sweeperAbi } from "@/lib/abi";
import { confirmTx } from "@/lib/confirm";
import { TEST_COLLECTIONS, TEST_NFTS_PER_CLAIM, testArtwork, testNftAbi } from "@/lib/testCollections";
import { useHub } from "../HubContext";

export function TestNfts() {
  const { address, isConnected, chainId } = useAccount();
  const client = usePublicClient({ chainId: monadTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChain } = useSwitchChain();
  const queryClient = useQueryClient();
  const { startSwap } = useHub();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const configured = TEST_COLLECTIONS.filter((c) => c.address);
  const wrongChain = isConnected && chainId !== monadTestnet.id;
  const state = useReadContracts({
    query: { enabled: !!address && !!SWEEPER_ADDRESS && configured.length > 0, refetchInterval: 15_000 },
    contracts: configured.flatMap((c) => [
      { address: c.address!, abi: testNftAbi, functionName: "claimed" as const, args: [address!] as const },
      { address: SWEEPER_ADDRESS!, abi: sweeperAbi, functionName: "isVerified" as const, args: [c.address!] as const },
    ]),
  });

  async function claim(c: typeof TEST_COLLECTIONS[number]) {
    if (!address || !c.address || wrongChain || busy || !client) return;
    setBusy(c.slug); setError(null); setHash(null);
    try {
      // Recheck verification immediately before asking the wallet to submit.
      if (!SWEEPER_ADDRESS || !await client.readContract({ address: SWEEPER_ADDRESS, abi: sweeperAbi, functionName: "isVerified", args: [c.address] })) throw new Error("This test collection is not enabled for trading yet.");
      const tx = await writeContractAsync({ address: c.address, abi: testNftAbi, functionName: "claim", chainId: monadTestnet.id });
      await confirmTx(client, tx);
      setHash(tx);
      await state.refetch();
      await queryClient.invalidateQueries({ queryKey: ["wallet-nfts"] });
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage ?? err.message ?? "Mint failed. Try again.");
    } finally { setBusy(null); }
  }

  return (
    <section aria-labelledby="test-nfts-title" className="space-y-6">
      <div>
        <p className="eyebrow">Monad Testnet · Practice trades</p>
        <h2 id="test-nfts-title" className="h-section mt-1">Get test NFTs. Try a swap.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-monad-muted">{configured.length ? "Connect your wallet, mint three test NFTs from each collection, then trade them for other NFTs or test MON. One claim per wallet per collection. You only pay network gas." : "Preview the three practice collections below. Wallet minting opens with the test release: three NFTs per collection, once per wallet, with only network gas to pay."}</p>
        <p className="mt-2 text-xs text-monad-muted">These are test replicas using sample artwork. They have no monetary value and are separate from the original NFT collections. You need test MON for gas.</p>
      </div>
      {wrongChain && <button type="button" className="btn-primary" onClick={() => switchChain({ chainId: monadTestnet.id })}>Switch to Monad Testnet</button>}
      <div className="grid gap-4 sm:grid-cols-3">
        {TEST_COLLECTIONS.map((c) => {
          const i = configured.findIndex((v) => v.slug === c.slug);
          const hasClaimed = i >= 0 && state.data?.[i * 2]?.result === true;
          const verified = i >= 0 && state.data?.[i * 2 + 1]?.result === true;
          const enabled = !!c.address && isConnected && !wrongChain && verified && !hasClaimed && !busy;
          const label = !c.address ? "Deployment pending" : !isConnected ? "Connect wallet to mint" : wrongChain ? "Switch network first" : busy === c.slug ? "Minting…" : hasClaimed ? "Already claimed" : state.isLoading ? "Checking availability…" : !verified ? "Trading not enabled yet" : `Mint ${TEST_NFTS_PER_CLAIM} test NFTs`;
          return (
            <article key={c.slug} className="rounded-2xl border border-monad-border bg-monad-surface/70 p-4">
              <div className="relative mx-auto aspect-square max-w-[220px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={testArtwork(c.slug, 1)} alt={`${c.name} sample NFT`} width={640} height={640} className="h-full w-full object-contain" loading="lazy" />
                <span className="absolute bottom-1 right-1 rounded-full border border-monad-border bg-monad-surface/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-monad-deep">Test replica</span>
              </div>
              <h3 className="mt-4 font-display text-lg font-bold">{c.name}</h3>
              <p className="mt-1 text-xs text-monad-muted">10 artwork variants · {TEST_NFTS_PER_CLAIM} NFTs per claim</p>
              <button type="button" disabled={!enabled} onClick={() => claim(c)} className="btn-primary mt-4 w-full !px-3 !text-xs">
                {busy === c.slug ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : hasClaimed ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />}{label}
              </button>
              {c.address && <a href={`${monadTestnet.blockExplorers.default.url}/address/${c.address}`} target="_blank" rel="noreferrer" className="mt-3 block text-center text-xs text-monad-deep hover:underline">View test contract</a>}
            </article>
          );
        })}
      </div>
      {error && <p role="alert" className="rounded-xl bg-status-dangerBg p-3 text-sm text-status-dangerInk">{error}</p>}
      {hash && <p role="status" className="text-sm text-status-activeInk">Your test NFTs are ready. <a href={`${monadTestnet.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer" className="underline">View transaction</a></p>}
      <button type="button" onClick={() => startSwap("open")} className="btn-ghost">Create a practice trade <ArrowRight className="h-4 w-4" aria-hidden /></button>
    </section>
  );
}
