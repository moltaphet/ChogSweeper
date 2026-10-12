"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeftRight, CheckCircle2, Gift, Globe, ImagePlus, Link2, Loader2, Plus, RefreshCw, Search, UserRound, Users, Wallet } from "lucide-react";
import { isAddress, type Address } from "viem";
import { useConnect, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { useAccount } from "@/lib/useAccount";
import { erc721Abi, sweeperAbi } from "@/lib/abi";
import { MAX_ASSETS_PER_SIDE, SWEEPER_ADDRESS, ZERO_ADDRESS, monadTestnet } from "@/lib/config";
import { formatMon, nftKey, parseMon, sameAddress, shortAddress } from "@/lib/format";
import { useCollections, useResolvedAddress } from "@/lib/hooks";
import { confirmTx } from "@/lib/confirm";
import { useWalletNFTs, type WalletNFTs } from "@/lib/useWalletNFTs";
import { resolveTokenFromApi, ResolveError } from "@/lib/api";
import type { NFTItem, SwapOffer } from "@/lib/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AssetSummaryCard } from "./AssetSummaryCard";
import { AddTokenForm } from "./AddTokenForm";
import { EmptyState } from "./EmptyState";
import { useHub, type OfferMode } from "./HubContext";
import { NFTSelectorGrid } from "./NFTSelectorGrid";
import { MonTicker } from "@/components/site/MonTicker";

const EXPIRY_OPTIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86_400 },
  { label: "7 days", seconds: 7 * 86_400 },
  { label: "30 days", seconds: 30 * 86_400 },
];

export function SwapBuilder() {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: monadTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const { mode, setMode } = useHub();
  const { collections, add: addCollection } = useCollections();
  const [newCollection, setNewCollection] = useState("");

  const [giveMon, setGiveMon] = useState("");
  const [wantMon, setWantMon] = useState("");
  const [targetInput, setTargetInput] = useState("");
  // Open offers name specific wanted tokens by contract + id: nobody's inventory to browse.
  const [openWanted, setOpenWanted] = useState<NFTItem[]>([]);
  const [addMineSignal, setAddMineSignal] = useState(0);
  const [addTheirsSignal, setAddTheirsSignal] = useState(0);
  const [expirySeconds, setExpirySeconds] = useState(EXPIRY_OPTIONS[1].seconds);

  const [busy, setBusy] = useState<null | "approve" | "create">(null);
  const [error, setError] = useState<string | null>(null);
  const [createdHash, setCreatedHash] = useState<string | null>(null);

  const mine = useWalletNFTs(address, { max: MAX_ASSETS_PER_SIDE, collections });
  const target = useResolvedAddress(targetInput);
  const targetAddress = target.state === "ok" ? target.address : undefined;
  const theirs = useWalletNFTs(mode === "direct" ? targetAddress : undefined, { max: MAX_ASSETS_PER_SIDE, collections });

  const giveWei = parseMon(giveMon);
  const wantWei = parseMon(wantMon);
  const giveItems = mine.selectedItems;
  const wantItems = mode === "direct" ? theirs.selectedItems : openWanted;

  // ---- approvals -------------------------------------------------------
  const giveCollections = useMemo(
    () => [...new Set(giveItems.map((i) => i.contract.toLowerCase()))] as Address[],
    [giveItems],
  );
  const approvals = useReadContracts({
    allowFailure: false,
    query: { enabled: !!address && !!SWEEPER_ADDRESS && giveCollections.length > 0 },
    contracts: giveCollections.map((c) => ({
      address: c,
      abi: erc721Abi,
      functionName: "isApprovedForAll" as const,
      args: [address!, SWEEPER_ADDRESS!] as const,
    })),
  });
  const unapproved = giveCollections.filter((_, i) => approvals.data?.[i] === false);
  const approvalsKnown = giveCollections.length === 0 || approvals.data !== undefined;
  const needsApproval = approvalsKnown && unapproved.length > 0;

  // ---- verified collections (the contract only accepts collections on its own list) ----
  const tradeCollections = useMemo(
    () => [...new Set([...giveItems, ...wantItems].map((i) => i.contract.toLowerCase()))] as Address[],
    [giveItems, wantItems],
  );
  const verifiedOnChain = useReadContracts({
    allowFailure: false,
    query: { enabled: !!SWEEPER_ADDRESS && tradeCollections.length > 0 },
    contracts: tradeCollections.map((c) => ({ address: SWEEPER_ADDRESS!, abi: sweeperAbi, functionName: "isVerified" as const, args: [c] as const })),
  });
  const notVerified = tradeCollections.filter((_, i) => verifiedOnChain.data?.[i] === false);

  // ---- what creating costs: the MON you give plus the platform fee, which the contract refunds if the swap is cancelled or declined
  const quote = useQuery({
    queryKey: ["creation-quote", address, String(giveWei ?? 0n)],
    enabled: !!address && !!SWEEPER_ADDRESS && !!publicClient && giveWei !== null,
    refetchInterval: 15_000,
    queryFn: () => publicClient!.readContract({ address: SWEEPER_ADDRESS!, abi: sweeperAbi, functionName: "quoteCreation", args: [address!, giveWei ?? 0n] }),
  });
  const feeWei = quote.data !== undefined && giveWei !== null ? quote.data - giveWei : null;

  // ---- validation ------------------------------------------------------
  const isOpenSwap = mode === "open";
  const problem = useMemo((): string | null => {
    if (!SWEEPER_ADDRESS) return "Set NEXT_PUBLIC_CHOGSWEEPER_ADDRESS to the deployed contract.";
    if (giveWei === null) return "Invalid MON amount in “You Give”.";
    if (wantWei === null) return "Invalid MON amount in “You Receive”.";
    if (giveItems.length === 0 && giveWei === 0n) return "Add at least one NFT or some MON to give.";
    if (notVerified.length > 0) {
      return `Only verified collections can be traded. ${notVerified.map(shortAddress).join(", ")} ${notVerified.length === 1 ? "is" : "are"} not on the ChogSweeper verified list.`;
    }
    if (mode === "direct") {
      if (target.state === "empty") return "Enter the collector\u2019s wallet, or switch to a Public Open Trade.";
      if (target.state === "invalid") return "Target must be a valid 0x address or ENS name.";
      if (target.state === "loading") return "Resolving target\u2026";
      if (targetAddress && sameAddress(targetAddress, address)) return "You cannot swap with yourself.";
    }
    return null;
  }, [giveWei, wantWei, giveItems.length, mode, target.state, targetAddress, address, notVerified]);

  const offer: SwapOffer | null = useMemo(() => {
    if (problem || giveWei === null || wantWei === null) return null;
    return {
      taker: mode === "direct" ? (targetAddress ?? ZERO_ADDRESS) : ZERO_ADDRESS,
      offered: giveItems.map(({ contract, tokenId }) => ({ contract, tokenId })),
      offeredMon: giveWei,
      wanted: wantItems.map(({ contract, tokenId }) => ({ contract, tokenId })),
      wantedMon: wantWei,
      expiry: 0, // filled in at submit time so it is never stale
    };
  }, [problem, giveWei, wantWei, mode, targetAddress, giveItems, wantItems]);

  // ---- gas estimate (only meaningful once approvals are in place) ------
  const gas = useQuery({
    queryKey: ["gas", offer?.taker, giveItems.map(nftKey), wantItems.map(nftKey), String(giveWei), String(wantWei), String(quote.data)],
    enabled: !!offer && !!address && approvalsKnown && !needsApproval && chainId === monadTestnet.id && quote.data !== undefined,
    retry: false,
    queryFn: async () => {
      const o = offer!;
      const [units, price] = await Promise.all([
        publicClient!.estimateContractGas({
          address: SWEEPER_ADDRESS!,
          abi: sweeperAbi,
          functionName: "createSwap",
          args: [
            o.taker,
            o.offered.map((a) => ({ nft: a.contract, tokenId: a.tokenId })),
            o.wanted.map((a) => ({ nft: a.contract, tokenId: a.tokenId })),
            o.offeredMon,
            o.wantedMon,
            BigInt(Math.floor(Date.now() / 1000) + expirySeconds),
          ],
          value: quote.data ?? o.offeredMon,
          account: address,
        }),
        publicClient!.getGasPrice(),
      ]);
      return { units, cost: units * price };
    },
  });

  // ---- actions ---------------------------------------------------------
  async function approveAll() {
    setError(null);
    setBusy("approve");
    try {
      for (const nft of unapproved) {
        const hash = await writeContractAsync({
          address: nft,
          abi: erc721Abi,
          functionName: "setApprovalForAll",
          args: [SWEEPER_ADDRESS!, true],
          chainId: monadTestnet.id,
        });
        await confirmTx(publicClient!, hash);
      }
      await approvals.refetch();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function createSwap() {
    if (!offer) return;
    setError(null);
    setBusy("create");
    try {
      // Quote again right before sending: the contract refuses any other amount, so a fee change in between cannot overcharge you.
      const due = await publicClient!.readContract({ address: SWEEPER_ADDRESS!, abi: sweeperAbi, functionName: "quoteCreation", args: [address!, offer.offeredMon] });
      const hash = await writeContractAsync({
        address: SWEEPER_ADDRESS!,
        abi: sweeperAbi,
        functionName: "createSwap",
        args: [
          offer.taker,
          offer.offered.map((a) => ({ nft: a.contract, tokenId: a.tokenId })),
          offer.wanted.map((a) => ({ nft: a.contract, tokenId: a.tokenId })),
          offer.offeredMon,
          offer.wantedMon,
          BigInt(Math.floor(Date.now() / 1000) + expirySeconds),
        ],
        value: due,
        chainId: monadTestnet.id,
      });
      await confirmTx(publicClient!, hash);
      setCreatedHash(hash);
      mine.clear();
      theirs.clear();
      setOpenWanted([]);
      setGiveMon("");
      setWantMon("");
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      queryClient.invalidateQueries({ queryKey: ["wallet-nfts"] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const wrongChain = isConnected && chainId !== monadTestnet.id;


  /** Resolve a token for an open offer's wanted list. No ownership check: anyone may end up holding it. */
  async function addOpenWanted(contract: string, tokenId: string) {
    if (!isAddress(contract, { strict: false })) return { ok: false as const, error: "Enter a valid contract address (0x…)." };
    if (!/^\d{1,78}$/.test(tokenId.trim())) return { ok: false as const, error: "Token ID must be a whole number." };
    if (openWanted.length >= MAX_ASSETS_PER_SIDE) return { ok: false as const, error: `You can ask for up to ${MAX_ASSETS_PER_SIDE} NFTs.` };
    try {
      const { item } = await resolveTokenFromApi(contract.trim().toLowerCase(), tokenId.trim());
      setOpenWanted((cur) => (cur.some((i) => nftKey(i) === nftKey(item)) ? cur : [...cur, item]));
      return { ok: true as const, item };
    } catch (e) {
      return { ok: false as const, error: e instanceof ResolveError ? e.message : "Lookup failed. Try again." };
    }
  }

  const hasDraft = giveItems.length > 0 || wantItems.length > 0 || giveMon.trim() !== "" || wantMon.trim() !== "";
  const isGift = mode === "open" && wantItems.length === 0 && (wantWei ?? 0n) === 0n;

  return (
    <div>
      {/* ------------------------------ Trade type ------------------------------ */}
      <div className="border-b border-monad-border/70 px-5 py-5 sm:px-7">
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      {/* The ticket: two halves of one deal, separated by a perforated seam. */}
      <div className="relative grid lg:grid-cols-2">
        <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-0.5 -translate-x-1/2 lg:block" aria-hidden>
          <div className="ticket-seam absolute inset-y-4 left-0 w-0.5" />
        </div>
        <span className="ticket-notch -top-3.5 hidden lg:block" aria-hidden />

        {/* ------------------------------ You Give ------------------------------ */}
        <section className="min-w-0 p-5 sm:p-7" aria-labelledby="give-heading">
          <header className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Your side</p>
              <h2 id="give-heading" className="font-display text-2xl font-extrabold tracking-tight">You Give</h2>
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-monad-muted">
                <Wallet className="h-3.5 w-3.5" aria-hidden />
                {address ? <span className="font-mono">{shortAddress(address)}</span> : "Connect a wallet to start"}
              </p>
            </div>
            <span className="pill" aria-label={`${giveItems.length} of ${MAX_ASSETS_PER_SIDE} NFTs selected`}>
              {giveItems.length}/{MAX_ASSETS_PER_SIDE}
            </span>
          </header>

          <NFTSelectorGrid
            items={mine.items}
            selected={mine.selectedKeys}
            onToggle={mine.toggle}
            onRemove={mine.removeToken}
            max={MAX_ASSETS_PER_SIDE}
            loading={mine.isLoading}
            disabled={!isConnected}
            emptyMessage="No NFTs to show."
            emptyContent={
              !isConnected ? (
                <EmptyState icon={Wallet} title="Connect your wallet first" body="Use the Connect wallet button at the top right of the page. Your Chogs and other Monad NFTs then appear here, ready to bundle into a trade." />
              ) : mine.isError ? (
                <EmptyState icon={RefreshCw} title="Couldn’t load your NFTs" body="The lookup failed. Try again, or add a token by hand." action={{ label: "Try again", onClick: () => mine.refetch(), icon: RefreshCw }} secondary={{ label: "Add by contract + ID", onClick: () => setAddMineSignal((n) => n + 1), icon: ImagePlus }} />
              ) : (
                <EmptyState icon={ImagePlus} title="No NFTs found in this wallet" body="Missing one? Add it by contract address and token ID." action={{ label: "Add by contract + ID", onClick: () => setAddMineSignal((n) => n + 1), icon: ImagePlus }} />
              )
            }
          />
          <InventoryNote inv={mine} enabled={isConnected} />
          <AddTokenForm
            onAdd={mine.addToken}
            onAdded={mine.toggle}
            disabled={!isConnected}
            disabledHint="Connect your wallet first."
            ownerNoun="your wallet"
            forceOpen={addMineSignal}
          />

          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (isAddress(newCollection)) {
                addCollection(newCollection);
                setNewCollection("");
              }
            }}
          >
            <input
              className="input font-mono"
              placeholder="Track another collection (0x…)"
              value={newCollection}
              onChange={(e) => setNewCollection(e.target.value)}
              aria-label="Collection address"
            />
            <button type="submit" className="btn-ghost shrink-0" disabled={!isAddress(newCollection)} aria-label="Add collection">
              <Plus className="h-4 w-4" />
            </button>
          </form>

          <MonField label="Add MON sweetener" value={giveMon} onChange={setGiveMon} invalid={giveWei === null} />
        </section>

        {/* ----------------------------- You Receive ---------------------------- */}
        <section className="min-w-0 border-t border-monad-border/70 p-5 sm:p-7 lg:border-t-0" aria-labelledby="receive-heading">
          <header className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">{mode === "direct" ? "Their side" : "Your ask"}</p>
              <h2 id="receive-heading" className="font-display text-2xl font-extrabold tracking-tight">You Receive</h2>
              <p className="mt-1 text-xs text-monad-muted">
                {mode === "direct" ? "Pick from their wallet, and/or ask for MON. Ask for nothing to send a gift." : "Name the NFTs you want, and/or ask for MON. Ask for nothing to give it away."}
              </p>
            </div>
            <span className="pill" aria-label={`${wantItems.length} of ${MAX_ASSETS_PER_SIDE} NFTs selected`}>
              {wantItems.length}/{MAX_ASSETS_PER_SIDE}
            </span>
          </header>

          {mode === "direct" ? (
            <>
              <label className="label" htmlFor="target">Collector&apos;s wallet</label>
              <div className="relative mt-1.5">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-monad-muted" />
                <input
                  id="target"
                  className="input pl-9 font-mono"
                  placeholder="0x… or name.eth"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <p className="mt-1.5 min-h-4 text-xs text-monad-muted" aria-live="polite">
                {target.state === "loading" && "Resolving…"}
                {target.state === "invalid" && <span className="text-status-dangerInk">Not a valid address or name.</span>}
                {target.state === "ok" && (
                  <span>
                    {target.fromName ? `${target.fromName} → ` : "Looking up "}
                    <span className="font-mono">{shortAddress(target.address)}</span>
                  </span>
                )}
              </p>

              <div className="mt-2">
                <NFTSelectorGrid
                  items={theirs.items}
                  selected={theirs.selectedKeys}
                  onToggle={theirs.toggle}
                  onRemove={theirs.removeToken}
                  max={MAX_ASSETS_PER_SIDE}
                  loading={theirs.isLoading}
                  disabled={!targetAddress}
                  emptyMessage="No NFTs to show."
                  emptyContent={
                    !targetAddress ? (
                      <EmptyState icon={Search} title="Who are you trading with?" body="Paste a wallet address or ENS name above to browse their NFTs." secondary={{ label: "Make it a public trade instead", onClick: () => setMode("open"), icon: Globe }} />
                    ) : theirs.isError ? (
                      <EmptyState icon={RefreshCw} title="Couldn’t load this wallet" body="The lookup failed. Try again, or add a token by hand." action={{ label: "Try again", onClick: () => theirs.refetch(), icon: RefreshCw }} />
                    ) : (
                      <EmptyState icon={Search} title="No NFTs found for this wallet" body="They may only hold MON, or a collection we don’t list yet. Add a token by contract + ID, or just ask for MON." action={{ label: "Add by contract + ID", onClick: () => setAddTheirsSignal((n) => n + 1), icon: ImagePlus }} />
                    )
                  }
                />
                <InventoryNote inv={theirs} enabled={!!targetAddress} />
                <AddTokenForm
                  onAdd={theirs.addToken}
                  onAdded={theirs.toggle}
                  disabled={!targetAddress}
                  disabledHint="Enter the collector’s wallet first."
                  ownerNoun="the collector’s wallet"
                  forceOpen={addTheirsSignal}
                />
              </div>
            </>
          ) : (
            <>
              <NFTSelectorGrid
                items={openWanted}
                selected={new Set(openWanted.map(nftKey))}
                onToggle={(i) => setOpenWanted((cur) => cur.filter((c) => nftKey(c) !== nftKey(i)))}
                max={MAX_ASSETS_PER_SIDE}
                emptyMessage="Nothing requested."
                emptyContent={
                  <EmptyState
                    icon={Link2}
                    title="Ask for specific NFTs (optional)"
                    body="Name a token by contract and ID, and whoever owns it can accept. Or ask for MON only."
                    action={{ label: "Add by contract + ID", onClick: () => setAddTheirsSignal((n) => n + 1), icon: ImagePlus }}
                  />
                }
              />
              {openWanted.length > 0 && <p className="mt-2 text-xs text-monad-muted">Tap an NFT to remove it from your ask.</p>}
              <AddTokenForm
                onAdd={addOpenWanted}
                title="Add an NFT you want"
                helpText="Anyone holding this token can accept your offer. Check the contract address: look-alike collections exist."
                forceOpen={addTheirsSignal}
              />
            </>
          )}

          <MonField label="Request MON" value={wantMon} onChange={setWantMon} invalid={wantWei === null} />
        </section>
      </div>

      {/* Tear-off line: everything below is the stub, the deal as it will settle. */}
      <div className="relative mt-2 h-0" aria-hidden>
        <span className="ticket-notch !left-0 -top-3.5" />
        <span className="ticket-notch !left-auto !right-0 !translate-x-1/2 -top-3.5" />
        <div className="absolute inset-x-6 top-0 border-t-2 border-dashed border-monad-border" />
      </div>

      {/* --------------------------- Atomic summary bar --------------------------- */}
      {/* Floats at the bottom of the screen once there is something to review, so the action stays in reach. */}
      <div className={`z-20 mx-3 mb-3 mt-5 rounded-2xl border border-white/80 bg-white/90 p-4 shadow-lift backdrop-blur-xl sm:mx-5 sm:mb-5 ${hasDraft ? "sticky bottom-3" : ""}`}>
        <div className="space-y-3">
          <div className="grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
            <AssetSummaryCard title="You give" nfts={giveItems} monWei={giveWei ?? 0n} compact onRemoveNft={(n) => { const item = giveItems.find((i) => nftKey(i) === nftKey(n)); if (item) mine.toggle(item); }} onClearMon={() => setGiveMon("")} />
            <ArrowLeftRight className="mx-auto hidden h-5 w-5 text-monad-primary md:block" aria-hidden />
            <AssetSummaryCard
              title="You receive"
              nfts={wantItems}
              monWei={wantWei ?? 0n}
              subtitle={mode === "direct" ? (targetAddress ? shortAddress(targetAddress) : undefined) : "Open to anyone"}
              compact
              onRemoveNft={(n) => { const item = wantItems.find((i) => nftKey(i) === nftKey(n)); if (item) theirs.toggle(item); }}
              onClearMon={() => setWantMon("")}
            />
          </div>

          {isGift && (
            <p className="flex items-start gap-2 rounded-lg bg-monad-tint px-3 py-2 text-xs text-monad-deep">
              <Gift className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> You&apos;re asking for nothing in return, so the first collector to accept gets everything you&apos;re giving.
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 text-xs text-monad-muted">
              <label className="flex items-center gap-2">
                Expires in
                <select
                  className="rounded-lg border border-monad-border bg-white px-2 py-1 text-xs text-monad-ink"
                  value={expirySeconds}
                  onChange={(e) => setExpirySeconds(Number(e.target.value))}
                >
                  {EXPIRY_OPTIONS.map((o) => (
                    <option key={o.seconds} value={o.seconds}>{o.label}</option>
                  ))}
                </select>
              </label>
              <span title="Paid by you when the swap is created, refunded in full if it is cancelled or declined, kept only when it is accepted. Zero for Chog holders and during promotions.">
                Platform fee:{" "}
                <strong className="text-monad-ink">{feeWei === null ? "…" : feeWei === 0n ? "Free" : <>{formatMon(feeWei, 6)} <MonTicker /></>}</strong>
                {feeWei !== null && feeWei > 0n && <span className="text-monad-muted"> (refunded if rejected)</span>}
              </span>
              <span title="Monad charges for the gas limit, so this is the amount reserved at the current gas price.">
                Est. gas:{" "}
                <strong className="text-monad-ink">
                  {gas.data ? <>{gas.data.units.toLocaleString()} (~{formatMon(gas.data.cost, 6)} <MonTicker />)</> : needsApproval ? "after approval" : "—"}
                </strong>
              </span>
            </div>

            <div className="flex items-center gap-3">
              <ol className="hidden items-center gap-2 text-xs font-medium sm:flex" aria-label="Steps">
                <Step n={1} label="Approve NFTs" done={!needsApproval && approvalsKnown && giveItems.length > 0} active={needsApproval} />
                <span className="h-px w-5 bg-monad-border" />
                <Step n={2} label={mode === "direct" ? "Send offer" : "Post trade"} done={!!createdHash && giveItems.length === 0} active={!needsApproval} />
              </ol>
              <ActionButton
                connected={isConnected}
                wrongChain={wrongChain}
                busy={busy}
                needsApproval={needsApproval}
                blockApprove={notVerified.length > 0}
                disabledReason={problem}
                onApprove={approveAll}
                onCreate={createSwap}
                createLabel={mode === "direct" ? "Send swap offer" : "Post public trade"}
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-status-dangerBg px-3 py-2 text-xs text-status-dangerInk">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}
          {createdHash && !error && (
            <p className="flex items-center gap-2 rounded-lg bg-status-activeBg px-3 py-2 text-xs text-status-activeInk">
              <CheckCircle2 className="h-4 w-4" /> Trade created.{" "}
              <a className="underline" target="_blank" rel="noreferrer" href={`${monadTestnet.blockExplorers.default.url}/tx/${createdHash}`}>
                View transaction
              </a>
              . Track it under Requests.
            </p>
          )}
          {problem && !error && !createdHash && <p className="text-xs text-monad-muted">{problem}</p>}
        </div>
      </div>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: OfferMode; onChange: (m: OfferMode) => void }) {
  const options = [
    { id: "direct" as const, label: "Direct P2P Swap", blurb: "Send an offer to one collector's wallet. Only they can accept.", icon: Users },
    { id: "open" as const, label: "Public Open Trade", blurb: "Post it publicly. The first collector to accept wins.", icon: Globe },
  ];
  return (
    <div role="radiogroup" aria-label="Trade type" className="grid gap-3 sm:grid-cols-2">
      {options.map(({ id, label, blurb, icon: Icon }) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(id)}
            className={`group relative flex items-start gap-3.5 rounded-2xl border p-4 text-left transition duration-200 ${
              active
                ? "border-monad-primary bg-gradient-to-br from-monad-tint to-white shadow-[0_10px_28px_-14px_rgba(94,67,243,0.55)] ring-1 ring-monad-primary/40"
                : "border-monad-border bg-white/70 hover:border-monad-primary/60 hover:bg-monad-tint/50"
            }`}
          >
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition ${active ? "bg-violet text-white shadow-[0_8px_16px_-8px_rgba(94,67,243,0.8)]" : "bg-monad-tint text-monad-deep group-hover:bg-white"}`}>
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 font-display text-base font-bold text-monad-ink">
                {label}
                {active && <CheckCircle2 className="h-4 w-4 text-monad-primary" aria-label="Selected" />}
              </span>
              <span className="mt-0.5 block text-sm text-monad-muted">{blurb}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MonField({ label, value, onChange, invalid }: { label: string; value: string; onChange: (v: string) => void; invalid: boolean }) {
  return (
    <div className="mt-4">
      <label className="label" htmlFor={label}>{label}</label>
      <div className="relative mt-1.5">
        <input
          id={label}
          inputMode="decimal"
          className={`input pr-14 ${invalid ? "border-status-danger focus:border-status-danger" : ""}`}
          placeholder="0.0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-xs font-bold text-coin-ink"><MonTicker className="h-4" /></span>
      </div>
    </div>
  );
}

function Step({ n, label, done, active }: { n: number; label: string; done: boolean; active: boolean }) {
  return (
    <li className={`flex items-center gap-1.5 ${active ? "text-monad-deep" : done ? "text-status-activeInk" : "text-monad-muted"}`}>
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
          done ? "bg-status-activeBg" : active ? "bg-monad-primary text-white" : "bg-monad-tint"
        }`}
      >
        {done ? "✓" : n}
      </span>
      {label}
    </li>
  );
}

function ActionButton(props: {
  connected: boolean;
  wrongChain: boolean;
  busy: null | "approve" | "create";
  needsApproval: boolean;
  /** Approving a collection the contract will refuse anyway would only cost the user gas. */
  blockApprove?: boolean;
  disabledReason: string | null;
  onApprove: () => void;
  onCreate: () => void;
  createLabel: string;
}) {
  const { switchChain } = useWalletActions();
  if (!props.connected) {
    return (
      <p className="inline-flex items-center gap-2 rounded-xl bg-status-warnBg px-4 py-2.5 text-sm font-semibold text-amber-900" role="status">
        <Wallet className="h-4 w-4 shrink-0" aria-hidden /> Connect your wallet first (top right)
      </p>
    );
  }
  if (props.wrongChain) return <button className="btn-primary" onClick={switchChain}>Switch to Monad Testnet</button>;
  if (props.busy) {
    return (
      <button className="btn-primary" disabled>
        <Loader2 className="h-4 w-4 animate-spin" /> {props.busy === "approve" ? "Approving…" : "Creating swap…"}
      </button>
    );
  }
  if (props.needsApproval) {
    return <button className="btn-primary" onClick={props.onApprove} disabled={props.blockApprove}>Approve NFTs</button>;
  }
  return (
    <button className="btn-primary" onClick={props.onCreate} disabled={!!props.disabledReason}>
      {props.createLabel}
    </button>
  );
}

function useWalletActions() {
  const { connectors, connect } = useConnect();
  const { switchChain } = useSwitchChain();
  return {
    connect: () => connectors[0] && connect({ connector: connectors[0], chainId: monadTestnet.id }),
    switchChain: () => switchChain({ chainId: monadTestnet.id }),
  };
}

function errorText(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string };
  return err.shortMessage ?? err.message ?? "Transaction failed.";
}

/** Tells the user when the list may be incomplete and gives them a way to recover. */
function InventoryNote({ inv, enabled }: { inv: WalletNFTs; enabled: boolean }) {
  if (!enabled || inv.isLoading) return null;
  return (
    <div className="mt-2 flex items-start justify-between gap-3 text-xs text-monad-muted">
      <p>
        {inv.partial
          ? "Some NFTs may be missing or still loading metadata. Refresh, or add a token by contract + ID below."
          : `${inv.items.length} NFT${inv.items.length === 1 ? "" : "s"} found`}
      </p>
      <button type="button" onClick={() => inv.refetch()} disabled={inv.isFetching} className="inline-flex shrink-0 items-center gap-1 font-medium text-monad-deep hover:underline disabled:opacity-60">
        <RefreshCw className={`h-3 w-3 ${inv.isFetching ? "animate-spin" : ""}`} aria-hidden /> Refresh
      </button>
    </div>
  );
}
