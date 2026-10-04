-- Refuse to silently rewrite PLO tables or hands as Hold'em.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tables WHERE game_type <> 'NLHE') THEN
    RAISE EXCEPTION 'cannot roll back 000008: non-NLHE tables exist';
  END IF;
END $$;

ALTER TABLE hands DROP COLUMN IF EXISTS game_type;
ALTER TABLE tables DROP CONSTRAINT tables_game_type_check;
ALTER TABLE tables ADD CONSTRAINT tables_game_type_check CHECK (game_type IN ('NLHE'));
