"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { useAccount } from "./useAccount";
import { confirmTx } from "./confirm";
import { erc721Abi, sweeperAbi } from "./abi";
import { SWEEPER_ADDRESS, ZERO_ADDRESS, monadTestnet } from "./config";
import { sameAddress } from "./format";
import type { SwapRecord } from "./types";

/**
 * Everything a viewer can do with a trade, shared by the list rows and the detail modal so both
 * enforce the same rules:
 *  - cancel:  the maker, while the trade is pending or expired (escrow is only released by cancelling)
 *  - decline: the designated taker, while pending
 *  - accept:  the designated taker (or anyone for an Open Counter), while pending and not expired
 */
export function useTradeActions(trade: SwapRecord) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: monadTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<null | "accept" | "decline" | "cancel">(null);
  const [error, setError] = useState<string | null>(null);

  const isMaker = sameAddress(trade.maker, address);
  const isOpen = trade.taker === ZERO_ADDRESS;
  const isDesignated = !isOpen && sameAddress(trade.taker, address);

  const canCancel = isMaker && (trade.status === "pending" || trade.status === "expired");
  const canDecline = !isMaker && isDesignated && trade.status === "pending";
  const canAccept = !isMaker && !!address && (isOpen || isDesignated) && trade.status === "pending";

  // A collection that is not in the verified registry may be a look-alike or a hostile contract whose tokens never
  // actually move on delivery. The contract cannot detect that, so accepting such a trade needs an explicit review.
  const hasUnverified = [...trade.offered, ...trade.wanted].some((a) => a.verified === false);
  const requiresReview = canAccept && hasUnverified;
  const isExpired = trade.status === "expired";

  // Exact msg.value the contract will demand for this viewer: wantedMon + fee, where the fee is zero for
  // Chog holders and during promotions. Asking the contract avoids guessing and avoids reverts.
  const quote = useQuery({
    queryKey: ["quote", trade.id.toString(), address],
    enabled: canAccept && !!publicClient && !!SWEEPER_ADDRESS,
    refetchInterval: 15_000,
    queryFn: () =>
      publicClient!.readContract({ address: SWEEPER_ADDRESS!, abi: sweeperAbi, functionName: "quoteAcceptance", args: [trade.id, address!] }),
  });

  async function run(kind: "accept" | "decline" | "cancel", action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trades"] }),
        queryClient.invalidateQueries({ queryKey: ["owned-nfts"] }),
      ]);
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage ?? err.message ?? "Transaction failed.");
    } finally {
      setBusy(null);
    }
  }

  const send = async (functionName: "cancelSwap" | "declineSwap") => {
    const hash = await writeContractAsync({ address: SWEEPER_ADDRESS!, abi: sweeperAbi, functionName, args: [trade.id], chainId: monadTestnet.id });
    await confirmTx(publicClient!, hash);
  };

  return {
    canAccept, canDecline, canCancel, requiresReview, isExpired,
    hasActions: canAccept || canDecline || canCancel,
    busy, error,
    /** Always zero for the taker: the maker pays the platform fee when creating the trade. Kept so callers need not change. */
    fee: quote.data !== undefined ? quote.data - trade.wantedMon : null,
    totalDue: quote.data ?? null,
    cancel: () => run("cancel", () => send("cancelSwap")),
    decline: () => run("decline", () => send("declineSwap")),
    accept: () =>
      run("accept", async () => {
        // The taker must approve each wanted collection before handing tokens over.
        const collections = [...new Set(trade.wanted.map((w) => w.contract.toLowerCase()))] as Address[];
        for (const nft of collections) {
          const approved = await publicClient!.readContract({
            address: nft, abi: erc721Abi, functionName: "isApprovedForAll", args: [address!, SWEEPER_ADDRESS!],
          });
          if (!approved) {
            const h = await writeContractAsync({
              address: nft, abi: erc721Abi, functionName: "setApprovalForAll", args: [SWEEPER_ADDRESS!, true], chainId: monadTestnet.id,
            });
            await confirmTx(publicClient!, h);
          }
        }
        // Re-quote right before sending: the fee may have changed since the modal opened.
        const required = await publicClient!.readContract({
          address: SWEEPER_ADDRESS!, abi: sweeperAbi, functionName: "quoteAcceptance", args: [trade.id, address!],
        });
        const hash = await writeContractAsync({
          address: SWEEPER_ADDRESS!, abi: sweeperAbi, functionName: "acceptSwap", args: [trade.id], value: required, chainId: monadTestnet.id,
        });
        await confirmTx(publicClient!, hash);
      }),
  };
}
