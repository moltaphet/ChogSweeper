import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { toEventSelector, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { sweeperAbi } from "../lib/abi";

const compiled = path.resolve(__dirname, "../../out/ChogSweeper.sol/ChogSweeper.json");
const generated = path.resolve(__dirname, "../lib/generated/ChogSweeper.abi.json");

describe.skipIf(!existsSync(compiled))("handwritten sweeperAbi matches the compiled contract", () => {
  // skipIf does not stop this body from running, so only read the artifact when it exists.
  const real = (existsSync(compiled) ? JSON.parse(readFileSync(compiled, "utf8")).abi : []) as any[];
  const sel = (i: any) => (i.type === "event" ? toEventSelector(i) : toFunctionSelector(i));

  it("every function and event the frontend uses exists on-chain with the same signature", () => {
    const onChain = new Set(real.filter((i) => i.type === "function" || i.type === "event").map((i) => `${i.type}:${sel(i)}`));
    for (const item of sweeperAbi as readonly any[]) {
      expect(onChain.has(`${item.type}:${sel(item)}`), `${item.type} ${item.name} is missing or its signature changed`).toBe(true);
    }
  });

  it("state mutability matches (a payable/view mismatch would break wallet calls)", () => {
    for (const item of sweeperAbi as readonly any[]) {
      if (item.type !== "function") continue;
      const r = real.find((i) => i.type === "function" && i.name === item.name)!;
      expect(item.stateMutability, `${item.name} mutability`).toBe(r.stateMutability);
    }
  });

  it.skipIf(!existsSync(generated))("the exported ABI file is current with the compiled artifact", () => {
    expect(JSON.parse(readFileSync(generated, "utf8"))).toEqual(real);
  });
});
