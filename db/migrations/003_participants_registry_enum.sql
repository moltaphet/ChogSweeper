-- 003: typed trade status (incl. stored EXPIRED), participants, verified collection registry.

-- ---------------------------------------------------------------- status enum
-- PENDING/ACCEPTED/CANCELLED/DECLINED mirror the contract. EXPIRED is time-derived: the indexer
-- writes it (projection + periodic sweep) so queries and indexes can filter on it directly.
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED', 'DECLINED', 'EXPIRED');

DROP INDEX swaps_open_idx;
ALTER TABLE swaps DROP CONSTRAINT swaps_status_check;
ALTER TABLE swaps ALTER COLUMN status TYPE "TradeStatus" USING (
  CASE status
    WHEN 'open'      THEN 'PENDING'
    WHEN 'accepted'  THEN 'ACCEPTED'
    WHEN 'cancelled' THEN 'CANCELLED'
    WHEN 'declined'  THEN 'DECLINED'
  END
)::"TradeStatus";
UPDATE swaps SET status = 'EXPIRED' WHERE status = 'PENDING' AND expiry < now();

CREATE INDEX swaps_pending_idx ON swaps (id DESC) WHERE status IN ('PENDING', 'EXPIRED');
-- Drives the expiry sweep.
CREATE INDEX swaps_expiry_sweep_idx ON swaps (expiry) WHERE status = 'PENDING';

-- ---------------------------------------------------------------- participants
CREATE TABLE participants (
  address          TEXT PRIMARY KEY,                  -- lowercase 0x
  first_seen_block BIGINT      NOT NULL,
  first_seen_at    TIMESTAMPTZ NOT NULL
);

INSERT INTO participants (address, first_seen_block, first_seen_at)
SELECT addr, MIN(block), MIN(at) FROM (
  SELECT maker       AS addr, created_block AS block, created_at AS at FROM swaps
  UNION ALL SELECT taker,       created_block, created_at FROM swaps WHERE taker IS NOT NULL
  UNION ALL SELECT accepted_by, created_block, created_at FROM swaps WHERE accepted_by IS NOT NULL
) p GROUP BY addr;

ALTER TABLE swaps ADD CONSTRAINT swaps_maker_fk       FOREIGN KEY (maker)       REFERENCES participants (address);
ALTER TABLE swaps ADD CONSTRAINT swaps_taker_fk       FOREIGN KEY (taker)       REFERENCES participants (address);
ALTER TABLE swaps ADD CONSTRAINT swaps_accepted_by_fk FOREIGN KEY (accepted_by) REFERENCES participants (address);

-- ---------------------------------------------------------------- asset -> token link
INSERT INTO nft_tokens (contract, token_id)
SELECT DISTINCT contract, token_id FROM swap_assets
ON CONFLICT DO NOTHING;
ALTER TABLE swap_assets
  ADD CONSTRAINT swap_assets_token_fk FOREIGN KEY (contract, token_id) REFERENCES nft_tokens (contract, token_id);

-- ---------------------------------------------------------------- verified collection registry
ALTER TABLE nft_collections
  ADD COLUMN verified  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN ecosystem TEXT CHECK (ecosystem IN ('chog', 'monad')),
  ADD COLUMN image_url TEXT,
  ADD COLUMN website   TEXT;
UPDATE nft_collections SET verified = TRUE, ecosystem = 'chog' WHERE is_chog;
-- A collection can only claim an ecosystem once it is verified.
ALTER TABLE nft_collections ADD CONSTRAINT nft_collections_verified_ck CHECK (ecosystem IS NULL OR verified);
CREATE INDEX nft_collections_verified_idx ON nft_collections (verified) WHERE verified;
