# Deploying ChogSweeper to Monad Testnet

Network: **Monad Testnet**, chain id `10143`, RPC `https://testnet-rpc.monad.xyz/`.

## 0. What you need

| Item | Notes |
| --- | --- |
| Foundry (`forge`, `cast`, `anvil`) | `foundryup` |
| Node 22+ | for `ops/`, the indexer and the web app |
| A funded deployer key | **about 1.2 MON** for the full deployment (mock Chog + seed mints + sweeper). Monad bills the gas *limit*, so the estimate is what must be present, not what is finally spent. Get testnet MON from the official faucet listed in Monad's docs. |
| Two funded wallets for the live smoke test | A (needs a little MON for gas), B (about 1 MON). The script tops B up from A if needed. |

Never commit a key. `.env` is git-ignored; use a throwaway testnet key.

## 1. Configure

```bash
cp .env.example .env
$EDITOR .env
```

| Variable | Meaning |
| --- | --- |
| `MONAD_TESTNET_RPC_URL` | `https://testnet-rpc.monad.xyz/` |
| `PRIVATE_KEY` | deployer; becomes the initial owner |
| `PLATFORM_FEE_WEI` | flat taker fee. `0` for free testnet trading; `50000000000000000` = 0.05 MON |
| `TREASURY_ADDRESS` | fee recipient (default: deployer) |
| `OWNER_ADDRESS` | optional final owner. Ownership transfer is only **started**; that address must call `acceptOwnership()` |
| `CHOG_COLLECTION` | use an existing Chog contract for the holder fee exemption. Leave empty to deploy `MockChog` |
| `DEPLOY_MOCK_CHOG` | default `true` when `CHOG_COLLECTION` is empty |
| `SEED_MINT_TO`, `SEED_MINT_COUNT` | mint mock Chogs to these wallets right after deploying |

The script refuses to run on any chain other than `EXPECTED_CHAIN_ID` (default 10143) and refuses to deploy `MockChog` anywhere except Monad Testnet or a local chain.

## 2. Dry run (sends nothing)

```bash
make dry-run
```

Simulates the whole deployment against the live RPC and prints the estimated cost. Check that the chain id is 10143 and the deployer has at least the "Estimated amount required".

## 3. Deploy and export

```bash
make deploy
```

This runs `forge script script/DeployChogSweeper.s.sol --broadcast`, then `ops/export-deployment.mjs`, which reads the broadcast receipts and writes:

| Output | Used by |
| --- | --- |
| `deployments/10143.json` | source of truth: addresses, deploy blocks, owner/fee/treasury read back from the chain |
| `web/lib/generated/*.abi.json`, `indexer/abi/*.abi.json` | ABIs from the compiled artifacts |
| `web/.env.local` | `NEXT_PUBLIC_CHOGSWEEPER_ADDRESS`, `NEXT_PUBLIC_DEPLOY_BLOCK`, `NEXT_PUBLIC_CHOG_COLLECTION`, `VERIFIED_COLLECTIONS`, ... |
| `indexer/.env` | `SWEEPER_ADDRESS`, `SWEEPER_DEPLOY_BLOCK`, `CHOG_COLLECTION`, `COLLECTIONS`, `CHAIN_ID`, `RPC_URLS` |

Existing keys in those env files are updated in place; everything else is left alone. `NEXT_PUBLIC_*` values are inlined at build time, so restart or rebuild the web app after exporting.

### Verified collections

`config/verified-collections.json` is the seed list per chain id (`ecosystem`: `chog` or `monad`, plus `startBlock`). The exporter combines it with the `MockChog` it just deployed (or your `CHOG_COLLECTION`) and writes:

* `VERIFIED_COLLECTIONS=addr:ecosystem:startBlock,...` for the web API (used when the indexer database is unreachable)
* `COLLECTIONS=addr:startBlock:ecosystem,...` for the indexer (becomes the database registry; re-applied on every boot)

To add the official Chog or a partner, append it to the seed file and run `make export`. `startBlock` should be the collection's deploy block.

## 4. Verify on-chain

```bash
make verify-onchain
```

Prints owner, pending owner, treasury, fee, Chog collection and trade count straight from the contract. They must match what you configured.

Optional source verification on the explorer uses Sourcify; take the verifier URL from Monad's current docs:

```bash
forge verify-contract <ADDRESS> src/ChogSweeper.sol:ChogSweeper --chain 10143 \
  --verifier sourcify --verifier-url <URL from Monad docs> \
  --constructor-args $(cast abi-encode "constructor(address,address,uint128)" <DEPLOYER> <TREASURY> <FEE_WEI>)
```

## 5. Start the services

```bash
# indexer (needs Postgres; see docker-compose.yml)
cd indexer && npm run build && node dist/main.js
# web
cd web && npm run build && npm start
```

Or `docker compose up --build` (reads `indexer/.env`).

## 6. Live smoke test on testnet

```bash
PRIVATE_KEY_A=0x... PRIVATE_KEY_B=0x... make smoke-testnet API=https://your-web-host
```

Without `API=` it checks the chain only. With it, it also checks what the UI reads (`/api/swaps` Incoming/Outgoing/History, `/api/wallet/inventory`, `/api/nft/resolve`).

It performs exactly this flow and asserts every step:

1. A mints a Chog, B mints a Chog and holds at least 1 MON
2. A approves the escrow and creates a swap: A's Chog for B's Chog + 0.5 MON
3. B sees the offer under **Incoming**
4. B accepts
5. Atomic settlement: both Chogs swapped, A received exactly 0.5 MON, B paid 0.5 MON + gas, nothing stuck in escrow
6. The swap is gone from Incoming and shows as Completed in both Histories; inventories are swapped

Balance checks on Monad allow for gas being billed at the gas *limit*: B's loss must fall between "gas used" and "gas limit". On a local chain the check is exact.

## 7. Full local rehearsal (no testnet funds needed)

```bash
make e2e-local
```

Starts anvil (chain id 10143), deploys with the real script, starts Postgres, the indexer and the API, runs the smoke test, then tears everything down. Logs: `.e2e/logs/`. Add `--keep` (`cd ops && node e2e-local.mjs --keep`) to leave the stack running.

## 8. Operating notes

* **Change the fee:** owner calls `setPlatformFee(uint128)`. Promotion: `setFeeWaivedUntil(unixTime)`. Capped at 10 MON.
* **Collect fees:** anyone can call `withdrawFees()`; funds only ever go to `treasury`.
* **Hand over ownership:** `transferOwnership(new)`, then the new owner calls `acceptOwnership()`.
* **If the export fails with "no receipt yet":** the transactions are still confirming. Wait, then `make export`.
* **Redeploying** creates a new contract and a new trade history. Re-run the export, point the indexer at an empty database (or a fresh one), and restart the web app.
