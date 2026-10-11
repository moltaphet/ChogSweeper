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
| `prisma/` | Prisma model of the indexer database |
| `config/` | verified-collection seed list per chain |

## How a swap works

1. The **maker** escrows up to 10 NFTs and/or MON, says what they want (NFTs and/or MON, or nothing for a gift), who may accept (one wallet or anyone) and when it expires.
2. The maker pays a flat **platform fee** at creation. It is **refunded** if the swap is cancelled or declined and kept only when it is accepted. Chog holders pay nothing; partner-collection holders get 25% off per token (up to 4).
3. The **taker** pays exactly the MON the maker asked for and both sides settle in one transaction.
4. Only collections on the contract's **verified list** can appear in a swap.

## Setup

```sh
git clone --recursive <repo-url>        # or: git submodule update --init --recursive
curl -L https://foundry.paradigm.xyz | bash && foundryup
(cd indexer && npm ci) && (cd web && npm ci) && (cd ops && npm ci)
```

Copy `web/.env.example` to `web/.env.local` and fill it in. Never commit a `.env` file; it is git-ignored.

## Commands

- `forge test` runs the contract tests.
- `cd web && npx vitest run` runs the web tests; `npm run typecheck` type-checks.
- `make test` runs contracts, indexer and web tests; `make e2e-local` runs the whole stack on a local chain.
- `make test-js` runs the contract behaviour tests without Foundry (in-process EVM).
- `make test-ui` drives the real app in a browser against a local chain (fake injected wallet): create, accept, decline, cancel, fee refund, verified-only, expiry. `cd ops/ui-e2e && npm test -- --all` also walks every page at desktop and phone widths.
- `make dry-run` simulates the deployment against Monad Testnet; `make deploy` broadcasts it (needs `PRIVATE_KEY`).
- `make smoke-testnet` runs a real trade between two funded wallets.
