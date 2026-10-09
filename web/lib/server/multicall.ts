import type { PublicClient } from "viem";

type Call = { address: `0x${string}`; abi: any; functionName: string; args?: readonly unknown[] };
export type CallResult = { status: "success"; result: any; error?: undefined } | { status: "failure"; result?: undefined; error: Error };

/**
 * Batched reads that work on any chain. `client.multicall` needs a Multicall3 contract; chains and local nodes without
 * one make it throw ("does not support contract multicall3") for the WHOLE batch, which used to surface as empty
 * inventories and "Unknown collection". If the batch itself fails we fall back to individual reads, so a missing
 * Multicall3 only costs speed, never correctness. Per-call failures (a revert) are reported per call, as with `allowFailure`.
 */
export async function safeMulticall(client: Pick<PublicClient, "multicall" | "readContract">, contracts: readonly Call[]): Promise<CallResult[]> {
  if (contracts.length === 0) return [];

  const individually = () =>
    Promise.all(
      contracts.map(async (c): Promise<CallResult> => {
        try {
          return { status: "success", result: await client.readContract({ address: c.address, abi: c.abi, functionName: c.functionName as never, args: c.args as never }) };
        } catch (e) {
          return { status: "failure", error: e instanceof Error ? e : new Error(String(e)) };
        }
      }),
    );

  let batch: CallResult[];
  try {
    batch = (await client.multicall({ allowFailure: true, contracts: contracts as any })) as CallResult[];
  } catch {
    return individually(); // the batch itself failed (no Multicall3 declared, RPC rejected it)
  }
  // Every call failing at once usually means the Multicall3 address has no code on this chain (the aggregate call then
  // "succeeds" with empty data and each result fails to decode), not that every call really reverted. Ask directly.
  // Genuine all-revert batches pay one extra round of cheap reads and get the same answers.
  return batch.every((r) => r.status === "failure") ? individually() : batch;
}
