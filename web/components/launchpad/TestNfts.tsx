"use client";

import { useMemo, useState } from "react";
import { ArrowRight, FlaskConical, Loader2 } from "lucide-react";
import { usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { type Address, zeroAddress } from "viem";
import { useAccount } from "@/lib/useAccount";
import { monadTestnet, SWEEPER_ADDRESS } from "@/lib/config";
import { sweeperAbi } from "@/lib/abi";
import { confirmTx } from "@/lib/confirm";
import { DEFAULT_TEST_MINT_COUNT, TEST_MINT_COLLECTIONS, testNftAbi } from "@/lib/testCollections";
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
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const configured = useMemo(() => TEST_MINT_COLLECTIONS.filter((c) => c.address), []);
  const wrongChain = isConnected && chainId !== monadTestnet.id;
  const state = useReadContracts({
    query: { enabled: !!SWEEPER_ADDRESS && configured.length > 0, refetchInterval: 15_000 },
    contracts: configured.flatMap((c) => [
      { address: c.address!, abi: testNftAbi, functionName: "name" as const, chainId: monadTestnet.id },
      { address: c.address!, abi: testNftAbi, functionName: "balanceOf" as const, args: [address ?? zeroAddress] as const, chainId: monadTestnet.id },
      { address: c.address!, abi: testNftAbi, functionName: "MAX_BATCH" as const, chainId: monadTestnet.id },
      { address: SWEEPER_ADDRESS!, abi: sweeperAbi, functionName: "isVerified" as const, args: [c.address!] as const, chainId: monadTestnet.id },
    ]),
  });

  const rows = TEST_MINT_COLLECTIONS.map((collection) => {
    const i = configured.findIndex((c) => c.slug === collection.slug);
    const offset = i * 4;
    const nameRead = i >= 0 ? state.data?.[offset] : undefined;
    const balanceRead = i >= 0 ? state.data?.[offset + 1] : undefined;
    const maxRead = i >= 0 ? state.data?.[offset + 2] : undefined;
    const verifiedRead = i >= 0 ? state.data?.[offset + 3] : undefined;
    return {
      ...collection,
      contractName: nameRead?.status === "success" ? String(nameRead.result) : collection.name,
      balance: balanceRead?.status === "success" ? (balanceRead.result as bigint) : null,
      maxBatch: maxRead?.status === "success" ? (maxRead.result as bigint) : null,
      verified: verifiedRead?.status === "success" && verifiedRead.result === true,
      hasRead: i >= 0 && !!state.data?.[offset],
    };
  });

  async function mint(slug: string, collectionAddress: Address, count: bigint) {
    if (!address || wrongChain || busy || !client || !SWEEPER_ADDRESS) return;
    setBusy(slug); setError(null); setHash(null);
    try {
      // Recheck the escrow's live allowlist before asking the wallet to mint.
      if (!await client.readContract({ address: SWEEPER_ADDRESS, abi: sweeperAbi, functionName: "isVerified", args: [collectionAddress] })) {
        throw new Error("This test collection is not enabled for trading yet.");
      }
      const tx = await writeContractAsync({ address: collectionAddress, abi: testNftAbi, functionName: "mintBatch", args: [address, count], chainId: monadTestnet.id });
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
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-monad-muted">Mint Mock Chog, r3tards, skrumpeys, and The Bobs on Monad Testnet. Choose 1–10 NFTs per transaction and mint again whenever you need more. Each collection must be verified by the ChogSweeper escrow before it can be traded.</p>
        <p className="mt-2 text-xs text-monad-muted">These are test replicas and mock NFTs with no monetary value. You only pay test MON for network gas; the mint has no price.</p>
      </div>
      {wrongChain && <button type="button" className="btn-primary" onClick={() => switchChain({ chainId: monadTestnet.id })}>Switch to Monad Testnet</button>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((c) => {
          const countText = amounts[c.slug] ?? String(Math.min(DEFAULT_TEST_MINT_COUNT, Number(c.maxBatch ?? 10n)));
          const countNum = /^\d+$/.test(countText) ? Number(countText) : 0;
          const count = Number.isSafeInteger(countNum) && countNum > 0 ? BigInt(countNum) : 0n;
          const validCount = count > 0n && c.maxBatch !== null && count <= c.maxBatch;
          const enabled = !!c.address && isConnected && !wrongChain && c.verified && validCount && !busy;
          const label = !c.address ? "Deployment pending" : !isConnected ? "Connect wallet to mint" : wrongChain ? "Switch network first" : busy === c.slug ? "Minting…" : c.hasRead && c.maxBatch === null ? "Mint unavailable" : !c.verified ? "Trading not enabled yet" : !validCount ? "Choose a valid amount" : `Mint ${count.toString()} test NFTs`;
          return (
            <article key={c.slug} className="rounded-2xl border border-monad-border bg-monad-surface/70 p-4">
              <div className="relative mx-auto aspect-square max-w-[220px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.preview} alt={`${c.name} sample NFT`} width={640} height={640} className="h-full w-full object-contain" loading="lazy" />
                <span className="absolute bottom-1 right-1 rounded-full border border-monad-border bg-monad-surface/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-monad-deep">Test replica</span>
              </div>
              <h3 className="mt-4 font-display text-lg font-bold">{c.contractName}</h3>
              <p className="mt-1 text-xs text-monad-muted">You own {c.balance === null ? "…" : c.balance.toString()} · up to {c.maxBatch?.toString() ?? "10"} per transaction</p>
              <label className="label mt-3 block" htmlFor={`mint-count-${c.slug}`}>NFTs to mint</label>
              <input
                id={`mint-count-${c.slug}`}
                className="input mt-1"
                type="number"
                min={1}
                max={c.maxBatch?.toString() ?? "10"}
                step={1}
                inputMode="numeric"
                value={countText}
                onChange={(event) => setAmounts((current) => ({ ...current, [c.slug]: event.target.value }))}
                disabled={!c.address || busy !== null}
              />
              <button type="button" disabled={!enabled} onClick={() => c.address && void mint(c.slug, c.address, count)} className="btn-primary mt-3 w-full !px-3 !text-xs">
                {busy === c.slug ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />}{label}
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
