-- Card-encryption key rotation: every hand records the id of the game
-- service's keyring key that sealed its deck and hole cards. Hands sealed
-- before key ids existed used the original key, id 1. Writers must set it
-- explicitly (no default once existing rows are backfilled).
ALTER TABLE hands ADD COLUMN seal_key_id integer NOT NULL DEFAULT 1 CHECK (seal_key_id >= 1);
ALTER TABLE hands ALTER COLUMN seal_key_id DROP DEFAULT;
