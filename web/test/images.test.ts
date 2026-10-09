import { ContractFunctionExecutionError, ContractFunctionRevertedError, ExecutionRevertedError, parseAbi } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import { proxyImage } from "../lib/server/image-proxy";
import { safeMulticall } from "../lib/server/multicall";
import { gatewayUrl, imageFields } from "../lib/server/nft-types";
import { resetGatewayHealth } from "../lib/server/nft-resolver";
import { getCollectionNames, isDeterministicFailure, readTokenUri, withTimeoutRetry, clearMetadataMemory, resolveTokenOnChain } from "../lib/server/tokens";
import { discoverOwnedTokens } from "../lib/server/discovery";

const C = "0x00000000000000000000000000000000000c0c0c";
const OWNER = "0x00000000000000000000000000000000000000a1";
const V0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PUBLIC = async () => [{ address: "93.184.216.34" }];

const abi = parseAbi(["function tokenURI(uint256) view returns (string)"]);
const reverted = () =>
  new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi, functionName: "tokenURI", message: "execution reverted" }), { abi, functionName: "tokenURI", args: [1n], contractAddress: C });

beforeEach(() => {
  resetGatewayHealth();
  clearMetadataMemory();
});

describe("safeMulticall (chains without Multicall3)", () => {
  const call = (fn: string, args: any[] = []) => ({ address: C as `0x${string}`, abi: parseAbi(["function name() view returns (string)", "function ownerOf(uint256) view returns (address)"]), functionName: fn, args });

  it("falls back to individual reads when the batch itself throws, keeping per-call failures per call", async () => {
    const client: any = {
      multicall: async () => { throw new Error('Chain "x" does not support contract "multicall3".'); },
      readContract: async ({ functionName }: any) => { if (functionName === "ownerOf") throw new Error("revert"); return "Uri Fixture"; },
    };
    const r = await safeMulticall(client, [call("name"), call("ownerOf", [1n])]);
    expect(r[0]).toMatchObject({ status: "success", result: "Uri Fixture" });
    expect(r[1]!.status).toBe("failure");
  });

  it("when the batch 'succeeds' but every call failed (Multicall3 has no code), it asks directly instead", async () => {
    const client: any = {
      multicall: async () => [{ status: "failure", error: new Error("Cannot decode zero data") }, { status: "failure", error: new Error("Cannot decode zero data") }],
      readContract: async ({ functionName }: any) => functionName === "name" ? "Uri Fixture" : "0x00000000000000000000000000000000000000a1",
    };
    const r = await safeMulticall(client, [call("name"), call("ownerOf", [1n])]);
    expect(r.map((x) => x.status)).toEqual(["success", "success"]);
    expect(r[0]!.result).toBe("Uri Fixture");
  });

  it("a partial failure is left alone: it is a real per-call revert, not a broken batch", async () => {
    let direct = 0;
    const client: any = { multicall: async () => [{ status: "success", result: "A" }, { status: "failure", error: new Error("revert") }], readContract: async () => (direct++, "x") };
    const r = await safeMulticall(client, [call("name"), call("ownerOf", [1n])]);
    expect(r.map((x) => x.status)).toEqual(["success", "failure"]);
    expect(direct).toBe(0);
  });

  it("uses the batch when it works, and handles empty input", async () => {
    let direct = 0;
    const client: any = { multicall: async () => [{ status: "success", result: "batched" }], readContract: async () => (direct++, "direct") };
    expect((await safeMulticall(client, [call("name")]))[0]!.result).toBe("batched");
    expect(direct).toBe(0);
    expect(await safeMulticall(client, [])).toEqual([]);
  });

  it("collection names survive a missing Multicall3 (this showed as 'Unknown collection')", async () => {
    const client: any = { multicall: async () => { throw new Error("no multicall3"); }, readContract: async () => "Uri Fixture" };
    expect((await getCollectionNames(client, ["0x0000000000000000000000000000000000001111"])).get("0x0000000000000000000000000000000000001111")).toBe("Uri Fixture");
  });

  it("wallet discovery still lists tokens when the chain has no Multicall3", async () => {
    const owners: Record<string, string> = { "7": OWNER };
    const client: any = {
      getBlockNumber: async () => 100n,
      multicall: async () => { throw new Error("no multicall3"); },
      getLogs: async () => [],
      readContract: async ({ functionName, args }: any) => {
        if (functionName === "balanceOf") return 1n;
        if (functionName === "tokenOfOwnerByIndex") return 7n;
        if (functionName === "ownerOf") return owners[String(args[0])];
        throw new Error("x");
      },
    };
    const r = await discoverOwnedTokens(client, OWNER, [{ address: C, startBlock: 0n }]);
    expect(r.tokens).toEqual([{ contract: C, tokenId: "7" }]);
  });
});

describe("reading the token URI (6s timeout, retries, uri() fallback)", () => {
  it("retries transient failures, then succeeds", async () => {
    let n = 0;
    const out = await withTimeoutRetry(async () => { if (++n < 3) throw new Error("ECONNRESET"); return "ok"; }, { baseDelayMs: 1 });
    expect(out).toBe("ok");
    expect(n).toBe(3);
  });

  it("gives up after the configured retries and reports the last error", async () => {
    let n = 0;
    await expect(withTimeoutRetry(async () => { n++; throw new Error("ECONNRESET"); }, { retries: 2, baseDelayMs: 1 })).rejects.toThrow("ECONNRESET");
    expect(n).toBe(3);
  });

  it("times out a hung call instead of waiting forever", async () => {
    const t0 = Date.now();
    await expect(withTimeoutRetry(() => new Promise(() => {}), { timeoutMs: 30, retries: 1, baseDelayMs: 1 })).rejects.toThrow(/timeout/);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("does NOT retry a contract revert: the answer will not change", async () => {
    let n = 0;
    await expect(withTimeoutRetry(async () => { n++; throw reverted(); }, { baseDelayMs: 1 })).rejects.toThrow();
    expect(n).toBe(1);
    expect(isDeterministicFailure(reverted())).toBe(true);
    expect(isDeterministicFailure(new Error("ECONNRESET"))).toBe(false);
  });

  it("recognises the revert shapes real nodes produce, not just the decoded one", () => {
    // What anvil / geth style nodes send for an unknown function on a contract without a fallback: no revert data at all.
    const bare = new ContractFunctionExecutionError(new ExecutionRevertedError({ message: "execution reverted" }), { abi, functionName: "tokenURI", args: [1n], contractAddress: C });
    expect(isDeterministicFailure(bare)).toBe(true);
    // A node that words it its own way is still caught by the message.
    const worded = new ContractFunctionExecutionError(new Error("VM Exception: execution reverted: nope") as any, { abi, functionName: "tokenURI", args: [1n], contractAddress: C });
    expect(isDeterministicFailure(worded)).toBe(true);
    // Transient problems are never treated as definitive answers.
    for (const msg of ["fetch failed", "HTTP request failed", "timeout", "rate limit exceeded", "503 Service Unavailable"]) {
      expect(isDeterministicFailure(new ContractFunctionExecutionError(new Error(msg) as any, { abi, functionName: "tokenURI", args: [1n], contractAddress: C }))).toBe(false);
    }
  });

  it("does not depend on instanceof: an error from ANOTHER copy of viem is still recognised (this broke in the Next bundle)", () => {
    class Foreign extends Error { constructor(name: string, public cause?: unknown, public shortMessage = "") { super(shortMessage); this.name = name; } }
    const reverted = new Foreign("ContractFunctionExecutionError", new Foreign("ContractFunctionRevertedError", undefined, 'The contract function "ownerOf" reverted.'));
    expect(isDeterministicFailure(reverted)).toBe(true);
    expect(isDeterministicFailure(new Foreign("ContractFunctionExecutionError", new Foreign("HttpRequestError", undefined, "HTTP request failed.")))).toBe(false);
    expect(isDeterministicFailure(new Foreign("ContractFunctionExecutionError", new Foreign("TimeoutError", undefined, "The request timed out.")))).toBe(false);
    // A contract that exists but does not implement the function (fallback returns nothing): "Cannot decode zero data".
    const zero = new Foreign("ContractFunctionExecutionError", new Foreign("AbiDecodingZeroDataError", undefined, 'Cannot decode zero data ("0x") with ABI parameters.'));
    expect(isDeterministicFailure(zero)).toBe(true);
    expect(isDeterministicFailure(null)).toBe(false);
    expect(isDeterministicFailure("boom")).toBe(false);
  });

  it("falls back from tokenURI to uri(id) only when tokenURI definitively fails", async () => {
    const calls: string[] = [];
    const client: any = { readContract: async ({ functionName }: any) => { calls.push(functionName); if (functionName === "tokenURI") throw reverted(); return "ipfs://x/{id}.json"; } };
    expect(await readTokenUri(client, C, 5n)).toEqual({ uri: "ipfs://x/{id}.json", via: "uri" });
    expect(calls).toEqual(["tokenURI", "uri"]);
  });

  it("a transient tokenURI failure is surfaced as such, not mistaken for 'no metadata' via uri()", async () => {
    const calls: string[] = [];
    const client: any = { readContract: async ({ functionName }: any) => { calls.push(functionName); throw new Error("503 service unavailable"); } };
    await expect(readTokenUri(client, C, 5n)).rejects.toThrow(/503/);
    expect(calls.every((c) => c === "tokenURI")).toBe(true); // retried tokenURI, never fell through to uri
  });

  it("end to end: relative image path + gateway-free (data:) metadata", async () => {
    const json = Buffer.from(JSON.stringify({ name: "Rel", image: "1.png" })).toString("base64");
    const client: any = { readContract: async () => `data:application/json;base64,${json}` };
    const m = await resolveTokenOnChain(client, C, 1n);
    expect(m.state).toBe("ok");
    expect(m.imageUri).toBeNull(); // a data: base cannot anchor a relative path, and we do not guess
  });
});

describe("image URLs handed to the browser", () => {
  it("ipfs:// goes through the proxy first, with two direct gateways behind it", () => {
    const f = imageFields(`ipfs://${V0}/7.png`, C, "7");
    expect(f.image).toBe(`/api/nft/image?url=${encodeURIComponent(`ipfs://${V0}/7.png`)}`);
    expect(f.imageFallbacks).toHaveLength(2);
    expect(f.imageFallbacks.every((u) => u.startsWith("https://") && u.includes(V0))).toBe(true);
  });

  it("ar:// goes through the proxy first, then the Arweave gateway", () => {
    const AR = "ZQ1xYsmSaTbVGQkwD5e7dqpw_0FprP9bWKCSbTW6qcM";
    const f = imageFields(`ar://${AR}`, C, "1");
    expect(f.image).toContain("/api/nft/image?url=");
    expect(f.imageFallbacks[0]).toBe(`https://arweave.net/${AR}`);
  });

  it("https is loaded directly with the proxy as the backup; plain http can only use the proxy (mixed content)", () => {
    expect(imageFields("https://cdn.example.com/a.png", C, "1")).toEqual({ image: "https://cdn.example.com/a.png", imageFallbacks: [`/api/nft/image?url=${encodeURIComponent("https://cdn.example.com/a.png")}`] });
    expect(imageFields("http://cdn.example.com/a.png", C, "1")).toEqual({ image: `/api/nft/image?url=${encodeURIComponent("http://cdn.example.com/a.png")}`, imageFallbacks: [] });
  });

  it("a gateway-style https URL that carries a CID is normalised so the proxy can try other gateways", () => {
    expect(imageFields(`https://some.gateway/ipfs/${V0}/a.png`, C, "1").image).toContain(encodeURIComponent(`ipfs://${V0}/a.png`));
  });

  it("small on-chain images are inlined; large ones are served by id; nothing yields nothing", () => {
    const small = "data:image/svg+xml;base64,AAAA";
    expect(imageFields(small, C, "1")).toEqual({ image: small, imageFallbacks: [] });
    expect(imageFields("data:image/png;base64," + "A".repeat(20_000), C, "9").image).toBe(`/api/nft/image?contract=${C}&tokenId=9`);
    expect(imageFields(null, C, "1")).toEqual({ image: null, imageFallbacks: [] });
  });

  it("gatewayUrl resolves ipfs:// and ar:// to plain http(s) gateway URLs (null for on-chain images)", () => {
    expect(gatewayUrl(`ipfs://${V0}/7.png`)).toMatch(/^https:\/\/.+\/ipfs\/Qm.+\/7\.png$/);
    expect(gatewayUrl("ar://ZQ1xYsmSaTbVGQkwD5e7dqpw_0FprP9bWKCSbTW6qcM")).toBe("https://arweave.net/ZQ1xYsmSaTbVGQkwD5e7dqpw_0FprP9bWKCSbTW6qcM");
    expect(gatewayUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(gatewayUrl(null)).toBeNull();
  });
});

describe("proxyImage (/api/nft/image?url=)", () => {
  const img = (type = "image/png", bytes = PNG) => new Response(bytes as any, { status: 200, headers: { "content-type": type } });

  it("streams an IPFS image from the first gateway that works and marks it cacheable forever", async () => {
    const fake = async (u: any) => (String(u).includes("pinata") ? img() : new Response("This IPFS gateway is switching to a service worker gateway only.", { status: 429 }));
    const r = await proxyImage(`ipfs://${V0}/1.png`, { fetch: fake as any, lookup: PUBLIC });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.headers["Content-Type"]).toBe("image/png");
    expect(r.headers["Cache-Control"]).toContain("immutable");
    expect(r.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(r.headers["Content-Security-Policy"]).toContain("sandbox");
    expect(r.headers["X-Image-Source"]).toContain("pinata");
  });

  it("plain URLs get a short cache, not an immutable one", async () => {
    const r = await proxyImage("https://cdn.example.com/a.png", { fetch: (async () => img()) as any, lookup: PUBLIC });
    expect(r.ok && r.headers["Cache-Control"]).not.toContain("immutable");
  });

  it("rejects missing, oversized, data: and unsupported URLs with 400", async () => {
    for (const bad of [null, "", "x".repeat(3000), "data:image/png;base64,AAAA", "javascript:alert(1)", "file:///etc/passwd", "ftp://x/y"]) {
      const r = await proxyImage(bad);
      expect(r).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("refuses private targets (SSRF) without contacting them", async () => {
    let contacted = false;
    const fake = async () => { contacted = true; return img(); };
    for (const u of ["http://127.0.0.1/a.png", "http://169.254.169.254/latest", "http://localhost:8080/a.png", "http://[::1]/a.png"]) {
      expect(await proxyImage(u, { fetch: fake as any, lookup: PUBLIC })).toMatchObject({ ok: false, status: 502 });
    }
    expect(contacted).toBe(false);
  });

  it("returns 502 when the target is not an image (HTML page, JSON) rather than relaying it", async () => {
    const html = async () => new Response("<html>hi</html>", { status: 200, headers: { "content-type": "text/html" } });
    expect(await proxyImage("https://a.example/page", { fetch: html as any, lookup: PUBLIC })).toMatchObject({ ok: false, status: 502 });
    const json = async () => new Response('{"a":1}', { status: 200, headers: { "content-type": "application/json" } });
    expect(await proxyImage("https://a.example/data", { fetch: json as any, lookup: PUBLIC })).toMatchObject({ ok: false, status: 502 });
  });

  it("does not leak upstream details in the error", async () => {
    const r = await proxyImage("https://secret-internal-name.example/a.png", { fetch: (async () => new Response("boom", { status: 500 })) as any, lookup: PUBLIC });
    expect(JSON.stringify(r)).not.toContain("secret-internal-name");
  });
});
