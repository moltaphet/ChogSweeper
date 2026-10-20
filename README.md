# ChogSweeper

**Peer-to-peer NFT swaps, settled atomically on Monad.**

[Open the app](https://chogsweeper.xyz) · [Source code](https://github.com/moltaphet/ChogSweeper) · [Architecture](docs/ARCHITECTURE.md) · [Testnet deployment](docs/DEPLOYMENT.md) · [Indexer hosting](docs/INDEXER_DEPLOY.md)

ChogSweeper is an EVM application for trading ERC-721 NFTs and native MON directly between wallets. A maker describes both sides of a trade and deposits the offered assets into the ChogSweeper escrow. A designated wallet can accept a direct offer, or anyone can accept a public offer. The contract transfers both sides in one transaction or leaves the offer open for cancellation, decline, or expiry handling.

The repository contains the escrow contract, a Next.js application, a Monad event and NFT indexer, and local deployment and test tooling. The current wallet flow targets **Monad Testnet**. The software is unaudited and should be treated as experimental.

## What the app does

- Create direct or public offers with up to 10 ERC-721 tokens per side, native MON, or both.
- Browse incoming requests, outgoing offers, public trades, transaction history, collections, and recent activity.
- Share the public-market link directly: visitors can browse open trades without connecting a wallet; connecting is only needed to accept one.
- Load wallet NFTs, resolve token metadata, and preview trade assets before signing.
- Show a confirmed on-chain receipt after swaps, NFT approvals, offer actions, and test mints, including the transaction hash, block, gas, and explorer link.
- Require each collection to be on the escrow contract's verified list before it can be offered or requested.
- Refund the maker's platform fee when a trade is cancelled or declined; retain it only after acceptance.
- Run a test faucet flow for Monad Testnet mock collections and show artwork previews for **r3tards**, **skrumpeys**, and **The Bobs**.

### How settlement works

1. The maker selects the offered NFTs and MON, specifies the requested NFTs and MON, chooses a direct recipient or an open offer, and sets an expiry.
2. The maker approves the escrow to transfer the selected NFTs and creates the offer. The maker sends the offered MON plus the quoted platform fee.
3. The taker accepts with exactly the requested MON. The contract transfers the NFTs and MON to their recipients atomically.
4. The maker can cancel an active offer; a designated taker can decline a direct offer. Both actions return the escrowed assets and fee to the maker. Expiry does not automatically return assets: the maker must cancel an expired offer.

The fee is paid by the maker, not the taker. Chog holders are exempt under the configured holder check; an optional partner collection can reduce the fee by 25% per token, up to four tokens. The owner can change future fee settings, but existing trades keep the fee quoted when they were created. Collected fees can only be withdrawn to the configured treasury.

**MON is the only payment currency implemented in the contract.** The trade builder displays CHOG as a disabled, mainnet-planned option. It cannot be selected or transferred. CHOG payment support would require ERC-20 settlement and approvals in the contract before it could be enabled. Chog NFTs and the planned CHOG payment token are separate things.

## Monad Testnet contracts

### Supported networks

| Network | Chain ID | Use |
| --- | ---: | --- |
| Monad Testnet | `10143` | Current wallet configuration and test deployment |
| Monad | `143` | Recognized by server-side read APIs; not enabled as a wallet network in the current app |
| Anvil | `31337` | Local contract and end-to-end development only |

### Deployed contracts

These are the contracts currently deployed for this project on Monad Testnet (`10143`). Use the explorer links to inspect them on-chain. The [deployment record](deployments/10143.json) is the source of truth for these addresses.

| Contract | Address | Notes |
| --- | --- | --- |
| ChogSweeper | [`0xc03F11e7114254F0b3b08E288d0fF496677D5d28`](https://testnet.monadexplorer.com/address/0xc03F11e7114254F0b3b08E288d0fF496677D5d28) | Escrow; deployment block `70087509` |
| MockChog | [`0xa1E4279a8E6F302F6f9DDb8f57CeDCB71A52f931`](https://testnet.monadexplorer.com/address/0xa1E4279a8E6F302F6f9DDb8f57CeDCB71A52f931) | Freely mintable test contract; deployment block `70087508` |
| Test r3tards | [`0x40fe14F1C25B3a581a4a6E1BF63DfA69CB73a916`](https://testnet.monadexplorer.com/address/0x40fe14F1C25B3a581a4a6E1BF63DfA69CB73a916) | Verified artwork replica; deployment block `72649588` |
| Test skrumpeys | [`0xE91d0544F7bdF88280Ea1b5FD8299Bf60DF8D058`](https://testnet.monadexplorer.com/address/0xE91d0544F7bdF88280Ea1b5FD8299Bf60DF8D058) | Verified artwork replica; deployment block `72649588` |
| Test The Bobs | [`0x49654139A5DF1B2f3AAA49611e9bA269E02859ed`](https://testnet.monadexplorer.com/address/0x49654139A5DF1B2f3AAA49611e9bA269E02859ed) | Verified artwork replica; deployment block `72649589` |

The test deployment's configured platform fee is `0.05 MON`. The four Mock partner collections are listed in [`config/verified-collections.json`](config/verified-collections.json). These Mock contracts are test assets and are not the original Chog or Monad collections. The deployment record may differ from a later on-chain owner configuration; verify live values with `make verify-onchain`.

## Test NFTs and artwork

The supplied 30 images are optimized WebP files under `web/public/collections/`:

```text
web/public/collections/
├── r3tards/01.webp … 10.webp
├── skrumpeys/01.webp … 10.webp
└── the-bobs/01.webp … 10.webp
```

The **Test NFTs** tab brings the four sample groups together: the existing, verified testnet `MockChog` plus test replicas for r3tards, skrumpeys, and The Bobs. Each replica contract is permissionlessly mintable in batches of up to 10 per transaction, with no lifetime wallet limit; users can mint another batch whenever they need more. There is no mint price; the wallet pays Monad Testnet gas. These test tokens have no monetary value and the three artwork replicas do not use the original collections' contracts.

All four test collections are deployed and verified on Monad Testnet. Their public addresses are recorded in [`deployments/10143.json`](deployments/10143.json) and generated into [`web/lib/generated/testCollections.ts`](web/lib/generated/testCollections.ts), so a fresh web build can discover them without manually adding hosting variables. The deployment export also fills the `NEXT_PUBLIC_TEST_*_ADDRESS` values in local environment files. To show replica images in external wallets, their on-chain metadata points to the public HTTPS origin serving these WebP files.

See [the deployment guide](docs/DEPLOYMENT.md#7b-more-collections-to-test-with-testnet-only) and [`script/DeployArtworkCollections.s.sol`](script/DeployArtworkCollections.s.sol) for the artwork replica process. The deployment script accepts a public `ARTWORK_BASE_URL`, checks that the broadcaster owns the escrow, and refuses chains other than Monad Testnet and Anvil.

## Architecture

```text
Wallet / browser
└── Next.js app
    ├── Sign transactions and read contracts ──> Monad Testnet
    └── API routes
        ├── Swaps, stats, and collections <── PostgreSQL <── Persistent indexer
        ├── Cached wallet inventory <──────── Redis (optional)
        └── Safe NFT image proxy ─────────────> HTTPS / IPFS / Arweave

Monad Testnet ──> Monad RPC ──> Persistent indexer ──> PostgreSQL
                                      └── Metadata resolver ──> HTTPS / IPFS / Arweave
```

### Main components

- **Escrow — `src/ChogSweeper.sol`:** trade lifecycle, NFT escrow, MON accounting, platform fee, holder discounts, and verified collection enforcement.
- **Web app — `web/`:** Next.js 14, React 18, TypeScript, wagmi, and viem. The landing page explains the protocol; `/launchpad` contains the trading workspace.
- **Indexer — `indexer/`:** a persistent Node.js worker that indexes escrow events and ERC-721 transfers, rebuilds projections, backfills newly registered collections, resolves metadata, and exposes `/healthz`.
- **Database — `db/migrations/`:** PostgreSQL schema and migrations used by the indexer and server APIs. Redis is an optional wallet-inventory cache.
- **Operations — `ops/` and `Makefile`:** deployment export, local backend, end-to-end runner, smoke tests, and browser test support.

The indexer keeps separate swap-event and NFT-transfer streams. It stores events with cursors in database transactions, checks block hashes for reorgs, replays from a rewind point when required, and invalidates affected wallet inventory cache entries. Metadata work is retried independently so a slow token URI does not stop event indexing. The web API can fall back to direct chain reads when indexed ownership is incomplete. The Public Trades view also merges recent on-chain offers with indexed records, so a reachable but lagging indexer does not hide newly posted offers. Database-backed history and marketplace statistics still need the indexer.

## App routes and API

| Route | Purpose |
| --- | --- |
| `/` | Landing page, protocol explanation, ecosystem, and project footer |
| `/launchpad` | Overview and all trading tools |
| `/launchpad?tab=new` | Build a direct or public swap; `mode=open` selects a public offer |
| `/launchpad?tab=requests` | Incoming and outgoing offers |
| `/launchpad?tab=history` | Completed, cancelled, and declined offers |
| `/launchpad?tab=public` | Open offers anyone can accept |
| `/launchpad?tab=collections` | Verified collection registry |
| `/launchpad?tab=activity` | Marketplace totals and recent activity |
| `/launchpad?tab=lookup` | Look up an NFT by collection address and token ID |
| `/launchpad?tab=faucet` | Monad Testnet faucet links, Mock minting, and artwork previews |
| `/launchpad?tab=test-nfts` | Mint the four verified Monad Testnet test collections (Mock Chog, r3tards, skrumpeys, and The Bobs) |
| `/swap` | Compatibility redirect to the Launchpad |

The active Launchpad tab is URL state, so a link can be shared or reloaded without losing the selected view.

| API route | Purpose |
| --- | --- |
| `GET /api/swaps` | Incoming, outgoing, history, or public offers; cursor-paginated |
| `GET /api/wallet/inventory` | Wallet NFTs, ownership, metadata, traits, and verified status |
| `GET /api/inventory` | Backwards-compatible alias for wallet inventory |
| `GET /api/nft/resolve` | Resolve one collection/token ID to NFT metadata |
| `GET /api/nft/image` | Stream an NFT image from a supported URI or token reference through the image safety proxy |
| `GET /api/stats` | Marketplace totals and recent activity from PostgreSQL |
| `GET /api/collections` | Verified collection registry |
| `GET /api/status` | RPC and indexer health used by the app status indicator |

Inventory and metadata routes validate input and rate-limit requests. Image and metadata fetches use URI normalization, public-address checks, pin each validated DNS result to its socket (including each redirect), enforce response limits, and validate content; they do not make arbitrary private network resources available to callers. See [Architecture: metadata and image resolution](docs/ARCHITECTURE.md#nft-metadata-and-image-resolution-what-to-know-when-an-image-does-not-show) for details.

## Repository map

| Path | Contents |
| --- | --- |
| `src/` | Escrow, testnet Mock collections, and artwork replica contract |
| `script/` | Escrow, Mock collection, and artwork replica deployment scripts |
| `test/` | Foundry unit, fuzz, invariant, and artwork collection tests |
| `web/` | Next.js pages, components, server APIs, styles, and artwork assets |
| `indexer/` | Chain streams, database access, metadata resolver, health endpoint, and tests |
| `db/migrations/` | PostgreSQL schema migrations |
| `config/` | Seed list of collections shown to the UI and scanned by the indexer |
| `deployments/` | Exported public deployment details by chain ID |
| `ops/` | Local backend runner, deployment exporter, smoke tests, and E2E tooling |
| `docs/` | Detailed architecture and operational deployment guides |
| `lib/` | Foundry dependencies, checked out as Git submodules |

## Development setup

### Requirements

- Node.js 22 or newer and npm.
- Foundry (`forge`, `cast`, and `anvil`) for Solidity builds, contract tests, and local-chain E2E.
- Git submodules for `forge-std` and OpenZeppelin Contracts.
- Docker only if you choose the Docker Compose backend instead of the embedded local backend.

Clone the repository and install each workspace's dependencies:

```bash
git clone --recurse-submodules https://github.com/moltaphet/ChogSweeper.git
cd ChogSweeper

(cd web && npm ci)
(cd indexer && npm ci)
(cd ops && npm ci)
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

### Run the web app

Copy the web environment template and set the public Monad Testnet contract values for the deployment you intend to use:

```bash
cp web/.env.example web/.env.local
```

At minimum, configure `NEXT_PUBLIC_CHOGSWEEPER_ADDRESS`, `NEXT_PUBLIC_DEPLOY_BLOCK`, and `NEXT_PUBLIC_CHOG_COLLECTION`. These are public client configuration, not secrets. The checked-in deployment data is in `deployments/10143.json`; `make export` can regenerate local web/indexer configuration from deployment artifacts.

```bash
cd web
npm run dev
```

Open `http://localhost:3000`. Use **Public Trades** in the main navigation or share `/launchpad?tab=public` so visitors can inspect open offers; they only need a connected wallet to accept. Recent public offers can still load from Monad Testnet when the indexer is unavailable, but Activity totals and full history remain indexer-backed.

### Run the local backend

Configure the indexer with a deployed escrow, deploy block, and RPC URL:

```bash
cp indexer/.env.example indexer/.env
```

Set `SWEEPER_ADDRESS`, `SWEEPER_DEPLOY_BLOCK`, and `RPC_URLS` in `indexer/.env`. To use the included persistent local PostgreSQL runner, set:

```dotenv
DATABASE_URL=postgres://postgres:chogsweeper-local@127.0.0.1:54329/chogsweeper
```

Then start the backend in one terminal:

```bash
cd ops
npm run dev:backend
```

This starts PostgreSQL under `.local/postgres`, applies database migrations, builds and starts the indexer, and fills a missing `DATABASE_URL` in the local web environment. It does not deploy contracts or send transactions. Keep it running, then start the web app in another terminal with `cd web && npm run dev`.

To run the full local stack in Docker instead, copy `indexer/.env.example` to the root `.env`, configure its chain variables, and run `docker compose up --build`.

## Tests and checks

```bash
make test                 # Foundry, indexer, and web test suites
make test-js              # Contract behavior tests using an in-process EVM
make e2e-local            # Anvil + PostgreSQL + indexer + web API + smoke flow
make test-ui              # Browser E2E on a local chain (Playwright/Chromium required)
```

Individual checks:

```bash
forge fmt --check
forge build --sizes
forge test -vvv
(cd indexer && npm run typecheck && npm test)
(cd web && npm run typecheck && npx vitest run)
```

GitHub Actions runs formatting, Solidity build and tests, indexer type checking/tests, and web type checking, tests, and production build on pushes and pull requests. `make e2e-local` uses a local Anvil chain and local database; it does not broadcast to Monad Testnet.

## Deploy to Monad Testnet

The deployment script defaults to chain ID `10143` and rejects a different chain unless `EXPECTED_CHAIN_ID` is deliberately changed. A deployed `MockChog` is allowed only on Monad Testnet or Anvil. Use a throwaway, funded testnet wallet and never commit its private key.

```bash
cp .env.example .env
# Set PRIVATE_KEY and review the fee/treasury/collection values in .env.
make dry-run
make deploy
make verify-onchain
```

`make dry-run` simulates without broadcasting. `make deploy` broadcasts the escrow deployment and exports addresses and ABIs to `deployments/`, `web/lib/generated/`, `indexer/abi/`, and local environment files. Review the simulation and chain ID before broadcasting. For a hosted application, copy the relevant public variables into the hosting provider and redeploy the web app; configure database and indexer secrets on their server-side services.

More detail, including verified collection configuration, source verification, smoke testing, and operating tasks, is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). For a Railway worker, Supabase PostgreSQL, and Vercel web app setup, see [docs/INDEXER_DEPLOY.md](docs/INDEXER_DEPLOY.md).

### Re-deploy the artwork replica collections

The three artwork replica contracts listed above are already deployed, registered in the escrow's verified collection list, and included in the generated web configuration. This procedure is only needed when creating a **new** test deployment; it is not required to enable the current Test NFTs flow.

For a new deployment, serve the image files under `web/public/collections/` from a public HTTPS origin, set `ARTWORK_BASE_URL`, `SWEEPER_ADDRESS`, and the escrow owner's `PRIVATE_KEY`, then simulate and broadcast [`script/DeployArtworkCollections.s.sol`](script/DeployArtworkCollections.s.sol) on Monad Testnet. Register the resulting addresses and regenerate app configuration with:

```bash
node ops/add-test-collections.mjs --chain-id 10143 --script DeployArtworkCollections.s.sol
make export
```

The script deploys separate test ERC-721 replicas; it does not claim, mint, or alter NFTs from the original collections. See [the deployment guide](docs/DEPLOYMENT.md#7b-more-collections-to-test-with-testnet-only) for the full procedure.

## Security and limits

- The smart contracts are **unaudited**. Use test assets and testnet MON only.
- The escrow accepts only ERC-721 assets from its owner-managed verified list. The list shown by the web/indexer and the on-chain list are separate and must be kept in sync.
- A verified collection is a trust decision. Malicious or non-standard token contracts can still behave unexpectedly; verify collection bytecode and provenance before adding it.
- Offers name specific `(collection, tokenId)` pairs. There are no ERC-1155 trades, ERC-2981 royalty payments, or “any token from this collection” offers.
- Expired offers remain escrowed until the maker cancels. Open public offers can be accepted by any wallet before expiry.
- Mock contracts are freely mintable test contracts and provide no real collection ownership or value.
- The protocol currently supports native MON payments only. CHOG is disabled in the UI; enabling it requires a separate ERC-20 settlement and approval implementation.
- NFT ownership indexing is limited to registered collections. Image availability also depends on the token's metadata URI, public network access, and the configured IPFS/Arweave gateways.

## Further reading

- [Indexing, data flow, API details, metadata resolution, and threat model](docs/ARCHITECTURE.md)
- [Contract deployment and testnet operations](docs/DEPLOYMENT.md)
- [Railway, Supabase, and Vercel indexer deployment](docs/INDEXER_DEPLOY.md)
