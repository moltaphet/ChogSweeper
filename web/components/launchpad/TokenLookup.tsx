"use client";

import { AlertCircle, ExternalLink, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { isAddress } from "viem";
import { monadTestnet } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { NftImage } from "../NftImage";
import { VerifiedBadge } from "../VerifiedBadge";

interface Resolved {
  contract: string;
  tokenId: string;
  name: string;
  collectionName: string;
  image: string | null;
  imageFallbacks: string[];
  isChog: boolean;
  verified: boolean;
  ecosystem: "chog" | "monad" | null;
  traits: Array<{ trait_type: string; value: string }>;
  owner: string | null;
  tradeable: boolean;
  error: string | null;
}

/** Look up any ERC-721 by contract and token id: who owns it, whether its collection is verified, and what it looks like. */
export function TokenLookup() {
  const [contract, setContract] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Resolved | null>(null);

  const valid = isAddress(contract.trim(), { strict: false }) && /^\d{1,78}$/.test(tokenId.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/nft/resolve?contract=${contract.trim()}&tokenId=${tokenId.trim()}`, { signal: AbortSignal.timeout(30_000) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Lookup failed (${res.status})`);
      setResult(body as Resolved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="lookup-title">
      <p className="eyebrow">Check before you trade</p>
      <h2 id="lookup-title" className="h-section mt-1">Token lookup</h2>
      <p className="mb-5 mt-2 max-w-xl text-sm text-monad-muted">Paste a contract address and a token id. You will see the owner, the artwork, and whether the collection is in the verified registry.</p>

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_9rem_auto]">
        <label className="block">
          <span className="label">Contract address</span>
          <input className="input mt-1 font-mono" placeholder="0x…" value={contract} onChange={(e) => setContract(e.target.value)} spellCheck={false} autoComplete="off" />
        </label>
        <label className="block">
          <span className="label">Token id</span>
          <input className="input mt-1 font-mono" inputMode="numeric" placeholder="1" value={tokenId} onChange={(e) => setTokenId(e.target.value)} />
        </label>
        <button type="submit" className="btn-primary self-end !py-3" disabled={!valid || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />} Look up
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-status-dangerBg px-4 py-3 text-sm text-status-dangerInk">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {result && (
        <article className="mt-6 flex flex-col gap-5 rounded-2xl border border-monad-border bg-white/80 p-4 shadow-card sm:flex-row">
          <NftImage src={result.image} fallbacks={result.imageFallbacks} alt={result.name} collectionName={result.collectionName} tokenId={result.tokenId} className="aspect-square w-full shrink-0 rounded-2xl sm:w-48" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h3 className="font-display text-xl font-bold">{result.name}</h3>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-monad-muted">
                {result.collectionName}
                <VerifiedBadge verified={result.verified} ecosystem={result.ecosystem} isChog={result.isChog} showUnverified />
              </p>
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-monad-muted">Contract</dt><dd className="font-mono">{shortAddress(result.contract)}</dd></div>
              <div><dt className="text-xs text-monad-muted">Owner</dt><dd className="font-mono">{result.owner ? shortAddress(result.owner) : "unknown"}</dd></div>
            </dl>
            {!result.tradeable && <p className="rounded-xl bg-status-warnBg px-3 py-2 text-xs text-status-warn">{result.error ?? "This token cannot be traded here."}</p>}
            {result.traits.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {result.traits.slice(0, 12).map((t) => (
                  <li key={`${t.trait_type}:${t.value}`} className="rounded-full bg-monad-tint px-2.5 py-1 text-xs text-monad-deep">
                    <span className="text-monad-muted">{t.trait_type}</span> {t.value}
                  </li>
                ))}
              </ul>
            )}
            <a href={`${monadTestnet.blockExplorers.default.url}/address/${result.contract}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-monad-deep hover:underline">
              Open contract on the explorer <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
        </article>
      )}
    </section>
  );
}
