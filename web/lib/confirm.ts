import type { Hash, PublicClient } from "viem";

/** Thrown when a transaction was mined but reverted. The wallet's "sent" is not "worked": the receipt decides. */
export class RevertedError extends Error {
  constructor(public readonly hash: Hash) {
    super("The transaction was mined but reverted on-chain, so nothing happened. Check the explorer for the reason.");
    this.name = "RevertedError";
  }
}

/** Waits for the receipt and throws unless the transaction succeeded. */
export async function confirmTx(client: Pick<PublicClient, "waitForTransactionReceipt">, hash: Hash) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new RevertedError(hash);
  return receipt;
}
