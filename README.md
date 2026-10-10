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
| `ops/` | deployment exporter, smoke test, local full-stack runner |
| `prisma/` | Prisma model of the indexer database |
| `config/` | verified-collection seed list per chain |

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
- `make dry-run` simulates the deployment against Monad Testnet; `make deploy` broadcasts it (needs `PRIVATE_KEY`).
- `make smoke-testnet` runs a real trade between two funded wallets.
