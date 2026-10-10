-- 004: richer, gateway-independent token metadata.
--  image_uri : canonical reference (ipfs://cid/path, ar://id, https URL or an image data URI). Gateways are applied at
--              read time, so changing or adding a gateway never requires re-resolving tokens.
--  image_url : legacy resolved URL, kept for compatibility; image_uri wins when present.
ALTER TABLE nft_tokens
  ADD COLUMN description TEXT,
  ADD COLUMN image_uri   TEXT,
  ADD COLUMN meta_error  TEXT;

UPDATE nft_tokens SET image_uri = image_url WHERE image_uri IS NULL AND image_url IS NOT NULL;
