import { describe, expect, it } from "vitest";
import { RevertedError, confirmTx } from "../lib/confirm";

const hash = "0x" + "ab".repeat(32);
const client = (status: "success" | "reverted") => ({ waitForTransactionReceipt: async () => ({ status }) }) as never;

describe("confirmTx", () => {
  it("returns the receipt of a successful transaction", async () => {
    await expect(confirmTx(client("success"), hash as `0x${string}`)).resolves.toMatchObject({ status: "success" });
  });
  it("throws when the transaction was mined but reverted (the UI must not say it worked)", async () => {
    await expect(confirmTx(client("reverted"), hash as `0x${string}`)).rejects.toBeInstanceOf(RevertedError);
  });
});
