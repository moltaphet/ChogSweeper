# ChogSweeper

Peer-to-peer NFT and MON swaps on Monad: escrow contract, indexer, API and trade-builder UI.

| Path | What |
| --- | --- |
| `src/` | `ChogSweeper.sol` escrow, `MockChog.sol` testnet collection |
| `script/` | `DeployChogSweeper.s.sol` |
| `indexer/` | event/transfer indexer and metadata resolver worker |
| `web/` | Next.js app and API routes |
| `ops/` | deployment exporter, smoke test, local full-stack runner |
| `db/`, `prisma/` | SQL migrations and the Prisma model |
| `docs/` | `ARCHITECTURE.md`, `DEPLOYMENT.md` |

Quick start: `make test`, then `make e2e-local` to watch a full trade run through every layer, then see `docs/DEPLOYMENT.md` for Monad Testnet.
