-- M9 Pot-Limit Omaha: tables may run PLO, and every hand records the game it
-- was dealt under (history rendering and replay after failover must not
-- depend on the table's current configuration).
ALTER TABLE tables DROP CONSTRAINT tables_game_type_check;
ALTER TABLE tables ADD CONSTRAINT tables_game_type_check CHECK (game_type IN ('NLHE', 'PLO'));

ALTER TABLE hands ADD COLUMN game_type text NOT NULL DEFAULT 'NLHE'
  CONSTRAINT hands_game_type_check CHECK (game_type IN ('NLHE', 'PLO'));
