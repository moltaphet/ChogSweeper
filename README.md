# ChogSweeper

Peer-to-peer NFT and MON swaps on Monad: escrow contract, indexer, API and trade-builder UI.

| Path | What |
| --- | --- |
| `src/` | `ChogSweeper.sol` escrow, `MockChog.sol` testnet collection |
| `script/` | `DeployChogSweeper.s.sol` |
| `test/` | Foundry tests (unit, fuzz, invariant) |
| `indexer/` | event/transfer indexer and metadata worker |
| `db/` | SQL migrations (source of truth for the schema) |
| `docs/` | `ARCHITECTURE.md`, `DEPLOYMENT.md` |
| `scripts/` | `sync-shared.mjs` copies `shared/nft-resolver.ts` into `indexer/` and `web/` |
| `web/` | Next.js app and API routes |
| `shared/` | `nft-resolver.ts`, the canonical metadata resolver (a copy lives in `web/lib/server/`) |
| `ops/` | deployment exporter, smoke test, local full-stack runner, `contract-tests/` (Foundry-free contract tests), `ui-e2e/` (browser tests) |
| `config/` | verified-collection seed list per chain |

## How a swap works

1. The **maker** escrows up to 10 NFTs and/or MON, says what they want (NFTs and/or MON, or nothing for a gift), who may accept (one wallet or anyone) and when it expires.
2. The maker pays a flat **platform fee** at creation. It is **refunded** if the swap is cancelled or declined and kept only when it is accepted. Chog holders pay nothing; partner-collection holders get 25% off per token (up to 4).
3. The **taker** pays exactly the MON the maker asked for and both sides settle in one transaction.
4. Only collections on the contract's **verified list** can appear in a swap.

## Payment currencies: MON now, CHOG planned for mainnet

- **MON is the only supported payment currency today.** The Launchpad uses native MON for the offered/requested payment amounts. Platform fees and network gas are also paid in MON.
- **CHOG is shown alongside MON in both sides of the Launchpad trade builder, but is disabled and marked “Mainnet”.** It cannot be selected, entered as a payment amount, approved or transferred through the current trading flow.
- **CHOG payment support is planned for the mainnet release.** The current escrow contract supports NFTs and native MON; showing CHOG in the interface does not add token settlement support. Activation requires the payment-token contract configuration, escrow support, approval flow and validation before release. Switching networks alone does not enable it.
- The planned CHOG payment token is separate from the **Chog NFTs** already supported in swaps and used for the holder fee exemption.

## Artwork and test NFTs

The landing page mixes Chog artwork with the supplied **r3tards**, **skrumpeys** and **The Bobs** samples.
The 30 supplied images are served as optimized WebP files from `web/public/collections/`.
Decorative cards do not represent a visitor's wallet holdings.

The Launchpad's Overview and **Test NFTs** tab (`/launchpad?tab=test-nfts`) show the three collections.
Their test replicas use `TestArtworkCollection.sol`: each wallet can claim **3 NFTs per collection, once**,
with no mint price (test MON is required for gas). Artwork cycles through the 10 samples in each collection.
These are separately deployed practice NFTs with no monetary value, not original collection tokens.

**Current setup:** artwork previews work locally. Minting is disabled with “Deployment pending” until the
replica contracts are deployed, registered in the escrow's verified list, and their addresses are configured.
For images to display inside external wallets, the WebP assets need a stable public HTTPS URL;
`127.0.0.1` cannot serve another visitor's wallet.

Once an HTTPS host is available:

1. Publish `collections/r3tards/01.webp` through `10.webp`, `collections/skrumpeys/…`, and `collections/the-bobs/…`
   under the origin set as `ARTWORK_BASE_URL` (for example `https://your-domain.example/`).
2. Simulate `script/DeployArtworkCollections.s.sol` with the escrow owner's `PRIVATE_KEY`, `SWEEPER_ADDRESS`
   and `ARTWORK_BASE_URL`. After reviewing the simulation, broadcast it to Monad Testnet. It deploys three
   new collections and verifies them in the existing escrow; it rejects mainnet.
3. Run `node ops/add-test-collections.mjs --chain-id 10143 --script DeployArtworkCollections.s.sol`, then
   `make export` to update the collection registry, frontend claim addresses and indexer seeds.
4. Restart the indexer and rebuild/restart the web app. Connect a wallet on Monad Testnet, claim test NFTs,
   then use **Create a practice trade**. Each mint requires confirmation in the user's wallet.

The claim addresses are `NEXT_PUBLIC_TEST_R3TARDS_ADDRESS`, `NEXT_PUBLIC_TEST_SKRUMPEYS_ADDRESS` and
`NEXT_PUBLIC_TEST_BOBS_ADDRESS`. Only addresses from this test deployment should be configured here.

## Setup

```sh
git clone --recursive <repo-url>        # or: git submodule update --init --recursive
curl -L https://foundry.paradigm.xyz | bash && foundryup
(cd indexer && npm ci) && (cd web && npm ci) && (cd ops && npm ci)
```

Copy `web/.env.example` to `web/.env.local` and fill it in. Never commit a `.env` file; it is git-ignored.

For the local backend, configure the deployed contract and RPC in `indexer/.env`, then run
`cd ops && npm run dev:backend`. This starts a persistent local PostgreSQL instance on `127.0.0.1:54329`,
applies migrations and starts the indexer. It adds `DATABASE_URL` to missing local env configuration;
existing database settings take precedence. Keep this terminal open, then run `cd web && npm run dev`
in another terminal. Data stays in `.local/postgres` after shutdown. Redis is optional locally.

## Commands

- `forge test` runs the contract tests.
- `cd web && npx vitest run` runs the web tests; `npm run typecheck` type-checks.
- `make test` runs contracts, indexer and web tests; `make e2e-local` runs the whole stack on a local chain.
- `make test-js` runs the contract behaviour tests without Foundry (in-process EVM).
- `make test-ui` drives the real app in a browser against a local chain (fake injected wallet): create, accept, decline, cancel, fee refund, verified-only, expiry. `cd ops/ui-e2e && npm test -- --all` also walks every page at desktop and phone widths.
- `make dry-run` simulates the deployment against Monad Testnet; `make deploy` broadcasts it (needs `PRIVATE_KEY`).
- `make smoke-testnet` runs a real trade between two funded wallets.
