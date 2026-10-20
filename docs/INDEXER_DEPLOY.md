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
   Its restart policy uses `ON_FAILURE` with 10 retries, which is supported on Railway Free. The Free plan does not support `ALWAYS`.
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
| `DATABASE_SSL_CA` | contents of the project's root CA certificate from **Supabase > Database > Settings > SSL configuration > Download certificate** |

The indexer verifies the Supabase pooler's TLS certificate using `DATABASE_SSL_CA`. Paste the certificate contents, including the PEM begin/end lines, into this variable. When this CA is set, the indexer removes conflicting SSL query parameters from `DATABASE_URL` before configuring TLS, so a pooler URL containing `sslmode=require` cannot override the supplied CA. Certificate verification stays enabled; do not set `rejectUnauthorized=false` or use `sslmode=no-verify`.

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
