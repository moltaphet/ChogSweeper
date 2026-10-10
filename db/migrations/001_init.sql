-- ChogSweeper indexer schema (PostgreSQL 14+, works on Supabase).
--
-- Design: raw chain events are the source of truth (swap_events, nft_transfers).
-- The swaps / swap_assets / nft_tokens tables are projections that are recomputed
-- from those events. This makes ingestion idempotent (replaying a block is a no-op)
-- and makes chain reorgs a "delete events >= block, recompute" operation.
--
-- Conventions: addresses are lowercase 0x text; uint256 values are NUMERIC(78,0).

-- ---------------------------------------------------------------- ingestion state

CREATE TABLE indexer_cursors (
  name        TEXT PRIMARY KEY,            -- 'sweeper' | 'transfers'
  block       BIGINT NOT NULL,             -- last fully processed block
  block_hash  TEXT   NOT NULL,             -- its hash, used to detect reorgs
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- swap events

CREATE TABLE swap_events (
  tx_hash       TEXT    NOT NULL,
  log_index     INTEGER NOT NULL,
  block_number  BIGINT  NOT NULL,
  block_hash    TEXT    NOT NULL,
  block_time    TIMESTAMPTZ NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('created', 'accepted', 'cancelled')),
  swap_id       NUMERIC(78, 0) NOT NULL,
  args          JSONB   NOT NULL,
  PRIMARY KEY (tx_hash, log_index)          -- deduplication key
);
CREATE INDEX swap_events_block_idx ON swap_events (block_number);
CREATE INDEX swap_events_swap_idx  ON swap_events (swap_id, block_number, log_index);

-- ---------------------------------------------------------------- swap projection

CREATE TABLE swaps (
  id             NUMERIC(78, 0) PRIMARY KEY,
  maker          TEXT NOT NULL,
  taker          TEXT,                      -- NULL = open to anyone
  status         TEXT NOT NULL CHECK (status IN ('open', 'accepted', 'cancelled')),
  accepted_by    TEXT,
  offered_mon    NUMERIC(78, 0) NOT NULL,
  wanted_mon     NUMERIC(78, 0) NOT NULL,
  expiry         TIMESTAMPTZ NOT NULL,
  created_block  BIGINT NOT NULL,
  created_tx     TEXT   NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL,
  settled_block  BIGINT,
  settled_tx     TEXT,
  settled_at     TIMESTAMPTZ
);
CREATE INDEX swaps_maker_idx       ON swaps (maker, id DESC);
CREATE INDEX swaps_taker_idx       ON swaps (taker, id DESC) WHERE taker IS NOT NULL;
CREATE INDEX swaps_accepted_by_idx ON swaps (accepted_by, id DESC) WHERE accepted_by IS NOT NULL;
CREATE INDEX swaps_open_idx        ON swaps (id DESC) WHERE status = 'open';

CREATE TABLE swap_assets (
  swap_id   NUMERIC(78, 0) NOT NULL REFERENCES swaps (id) ON DELETE CASCADE,
  side      TEXT    NOT NULL CHECK (side IN ('offered', 'wanted')),
  position  INTEGER NOT NULL,
  contract  TEXT    NOT NULL,
  token_id  NUMERIC(78, 0) NOT NULL,
  PRIMARY KEY (swap_id, side, position)
);
CREATE INDEX swap_assets_token_idx ON swap_assets (contract, token_id);

-- ---------------------------------------------------------------- NFT collections

CREATE TABLE nft_collections (
  address        TEXT PRIMARY KEY,
  name           TEXT,
  symbol         TEXT,
  is_chog        BOOLEAN NOT NULL DEFAULT FALSE,
  start_block    BIGINT  NOT NULL DEFAULT 0,   -- first block to backfill from
  backfilled_to  BIGINT  NOT NULL DEFAULT -1,  -- historic Transfer logs indexed up to here
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE nft_transfers (
  tx_hash       TEXT    NOT NULL,
  log_index     INTEGER NOT NULL,
  block_number  BIGINT  NOT NULL,
  block_hash    TEXT    NOT NULL,
  contract      TEXT    NOT NULL,
  token_id      NUMERIC(78, 0) NOT NULL,
  from_addr     TEXT    NOT NULL,
  to_addr       TEXT    NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX nft_transfers_token_idx ON nft_transfers (contract, token_id, block_number DESC, log_index DESC);
CREATE INDEX nft_transfers_block_idx ON nft_transfers (block_number);

-- ---------------------------------------------------------------- NFT tokens (ownership + metadata)

CREATE TABLE nft_tokens (
  contract           TEXT NOT NULL,
  token_id           NUMERIC(78, 0) NOT NULL,
  owner              TEXT,                      -- NULL once burned
  token_uri          TEXT,
  name               TEXT,
  image_url          TEXT,                      -- normalized http(s)/data URL, ready for <img>
  attributes         JSONB,
  meta_status        TEXT NOT NULL DEFAULT 'pending' CHECK (meta_status IN ('pending', 'ok', 'failed')),
  meta_attempts      INTEGER NOT NULL DEFAULT 0,
  meta_next_attempt  TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta_fetched_at    TIMESTAMPTZ,
  PRIMARY KEY (contract, token_id)
);
-- Wallet inventory lookups.
CREATE INDEX nft_tokens_owner_idx ON nft_tokens (owner, contract, token_id) WHERE owner IS NOT NULL;
-- Metadata work queue.
CREATE INDEX nft_tokens_meta_queue_idx ON nft_tokens (meta_next_attempt) WHERE meta_status <> 'ok' AND owner IS NOT NULL;

-- Trait index for filtering / rarity queries.
CREATE TABLE nft_traits (
  contract    TEXT NOT NULL,
  token_id    NUMERIC(78, 0) NOT NULL,
  trait_type  TEXT NOT NULL,
  value       TEXT NOT NULL,
  PRIMARY KEY (contract, token_id, trait_type, value),
  FOREIGN KEY (contract, token_id) REFERENCES nft_tokens (contract, token_id) ON DELETE CASCADE
);
CREATE INDEX nft_traits_lookup_idx ON nft_traits (contract, trait_type, value);
