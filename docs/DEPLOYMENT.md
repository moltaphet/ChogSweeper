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
| `PLATFORM_FEE_WEI` | flat fee the maker pays when creating a swap (refunded if it is cancelled or declined). `0` for free testnet trading; `50000000000000000` = 0.05 MON |
| `TREASURY_ADDRESS` | fee recipient (default: deployer) |
| `OWNER_ADDRESS` | optional final owner. Ownership transfer is only **started**; that address must call `acceptOwnership()` |
| `CHOG_COLLECTION` | use an existing Chog contract for the holder fee exemption (it is added to the on-chain tradeable list). Leave empty to deploy `MockChog` |
| `PARTNER_COLLECTION` | optional partner collection: 25% off the fee per token held, up to 4 tokens (also added to the tradeable list) |
| `TRADEABLE_COLLECTIONS` | comma separated extra collections that may be traded. Only Chog, the partner and these can appear in a trade; owner can change the list later with `setVerifiedCollections` |
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

The seed file only feeds the UI and the indexer. **What can actually be traded is the contract's own list**, which `make deploy` fills from `CHOG_COLLECTION`, `PARTNER_COLLECTION` and `TRADEABLE_COLLECTIONS`. To add one later, the owner calls:

```sh
cast send $SWEEPER "setVerifiedCollections(address[],bool)" "[0xCollection1,0xCollection2]" true --rpc-url $MONAD_TESTNET_RPC_URL --private-key $OWNER_KEY
```

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

## 7b. More collections to test with (testnet only)

```bash
# SEED_MINT_TO = the wallet(s) that should receive tokens (comma separated); SEED_MINT_COUNT per collection, default 5
SEED_MINT_TO=0xYourWallet make test-collections
```

Deploys four mock partner collections (`MockCollection`: Mock Molandak, Mock Moyaki, Mock Chewy, Mock Mop), mints tokens to `SEED_MINT_TO`, verifies them on the deployed ChogSweeper (the key must be its owner), adds them to `config/verified-collections.json` and re-runs the export. Restart the web app afterwards and, on Vercel, update `NEXT_PUBLIC_COLLECTIONS` from `web/.env.local`.

## 7c. Test artwork replicas (testnet only)

`MockChog` is already a verified, permissionlessly mintable test collection. The three supplied artwork groups use separate replica contracts. Each lets anyone mint 1–10 tokens per transaction and can be called repeatedly; only Monad Testnet and Anvil are allowed.

Set `ARTWORK_BASE_URL` to the public HTTPS origin that serves `collections/r3tards/`, `collections/skrumpeys/`, and `collections/the-bobs/`. Set `SWEEPER_ADDRESS` to the deployed escrow and use the escrow owner's `PRIVATE_KEY`. Then simulate and broadcast the artwork deployment:

```bash
forge script script/DeployArtworkCollections.s.sol --rpc-url "$MONAD_TESTNET_RPC_URL"
forge script script/DeployArtworkCollections.s.sol --rpc-url "$MONAD_TESTNET_RPC_URL" --broadcast
node ops/add-test-collections.mjs --chain-id 10143 --script DeployArtworkCollections.s.sol
make export
```

The deployment script adds all three replicas to the escrow's verified list. The export writes their addresses to `web/.env.local`, `deployments/10143.json`, `config/verified-collections.json`, and the generated `web/lib/generated/testCollections.ts`. Commit the deployment record, registry, and generated file so the hosted web build can find the public addresses without manual Vercel variables. Update the hosted indexer's `COLLECTIONS` environment and restart it to backfill the new transfer streams; until then, wallet discovery can read the verified enumerable contracts directly from chain. The Launchpad's combined **Test Faucet** tab checks the live escrow allowlist before enabling each mint button.

## 7c. Connect the real Chog collection

You need two facts about the official Chog **ERC-721** NFT collection on the chain your escrow runs on: its contract address and its deploy block (both on the explorer). The CHOG meme token is an ERC-20 and cannot be used. If the NFT only exists on Monad mainnet (chain 143), a testnet escrow cannot see it; that needs a mainnet deployment (unaudited, so a deliberate decision).

```bash
make connect-chog CHOG=0xCollection START_BLOCK=12345678
```

It checks the address answers as an ERC-721, calls `setChogCollection` and `setVerifiedCollections` on the escrow (the key in `.env` must be its owner), records the collection in `config/verified-collections.json` as the Chog ecosystem (the mock becomes an ordinary verified collection) and re-runs the export. Then copy the new `NEXT_PUBLIC_CHOG_COLLECTION`, `NEXT_PUBLIC_COLLECTIONS` and `VERIFIED_COLLECTIONS` into Vercel and `COLLECTIONS` / `CHOG_COLLECTION` into Railway, and redeploy both.

## 8. Operating notes

* **Change the fee:** owner calls `setPlatformFee(uint128)`. Promotion: `setFeeWaivedUntil(unixTime)`. Capped at 10 MON. Existing trades keep the fee they paid.
* **Tradeable collections:** owner calls `setVerifiedCollections(address[], bool)`. Keep it aligned with `config/verified-collections.json`; a collection missing on-chain cannot appear in any trade even if the UI lists it.
* **Partner discount:** `setPartnerCollection(address)`.
* **Collect fees:** anyone can call `withdrawFees()`; funds only ever go to `treasury`.
* **Hand over ownership:** `transferOwnership(new)`, then the new owner calls `acceptOwnership()`.
* **If the export fails with "no receipt yet":** the transactions are still confirming. Wait, then `make export`.
* **Redeploying** creates a new contract and a new trade history. Re-run the export, point the indexer at an empty database (or a fresh one), and restart the web app.
