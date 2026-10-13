# Indexer on Railway + Supabase (testnet)

Without the indexer the site still works (it reads open trades straight from the contract) but history rows have no NFTs,
the stats and activity pages are empty and wallet inventories are slower. The indexer fills a Postgres database that the
web app reads. Free tiers are enough for the testnet.

## 1. Supabase (the database)
1. Create a project at supabase.com (note the database password).
2. *Project Settings > Database > Connection string*. You need two strings:
   * **Session pooler** (port 5432) for the indexer, because it runs migrations and long transactions.
   * **Transaction pooler** (port 6543) for the web app on Vercel.
   Replace `[YOUR-PASSWORD]` in both.

## 2. Railway (the indexer)
1. New Project > Deploy from GitHub repo > `moltaphet/ChogSweeper`. The root `railway.json` selects `indexer/Dockerfile`.
2. Variables (Service > Variables):

| Variable | Value |
|---|---|
| `RPC_URLS` | `https://testnet-rpc.monad.xyz` |
| `CHAIN_ID` | `10143` |
| `SWEEPER_ADDRESS` | `0xc03F11e7114254F0b3b08E288d0fF496677D5d28` |
| `SWEEPER_DEPLOY_BLOCK` | `70087509` |
| `MAX_BLOCK_RANGE` | `100` |
| `CHOG_COLLECTION` | `0xa1E4279a8E6F302F6f9DDb8f57CeDCB71A52f931` |
| `COLLECTIONS` | `0xa1E4279a8E6F302F6f9DDb8f57CeDCB71A52f931:70087508:chog,0x786bd6B0a35c5053877D66cdDe88A6b2338EC69c:70502856:monad,0x1f7d461268e5568D09eAe9182429c3F0644E4382:70502856:monad,0x34eD3457B063057742a64e83D3a58fC75eF9e12a:70502856:monad,0x422CC82C81551bebED18Ce2B7204113F1401A386:70502857:monad` |
| `DATABASE_URL` | the Supabase **session pooler** string |

(`COLLECTIONS` is the `indexer/.env` line written by `make export`; copy it from there if the collection list changes.)

3. Deploy. Logs should show `indexer starting`, then it catches up from the deploy block (about 100 blocks per request, a few
   minutes). It creates the tables itself on first start.

## 3. Vercel (the web app): add these, then Redeploy
| Variable | Value |
|---|---|
| `DATABASE_URL` | the Supabase **transaction pooler** string |
| `INDEXER_CHAIN_ID` | `10143` |
| `VERIFIED_COLLECTIONS` | the `VERIFIED_COLLECTIONS` line from `web/.env.local` (same five collections, `address:ecosystem:startBlock`) |

## 4. Check
* Railway logs show blocks advancing; `trades` rows appear in Supabase (Table editor).
* On the site, Launchpad > Overview shows counts and Activity lists trades; History rows show their NFTs.
