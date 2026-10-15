DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM operators) THEN
    RAISE EXCEPTION 'operators exist; their worlds would be merged into KofClub''s';
  END IF;
END
$$;
DROP TRIGGER club_members_same_world ON club_members;
DROP TRIGGER clubs_same_world ON clubs;
DROP FUNCTION same_world_check();
ALTER TABLE telegram_accounts DROP CONSTRAINT telegram_accounts_user_operator_fkey;
ALTER TABLE telegram_accounts DROP CONSTRAINT telegram_accounts_telegram_user_key;
ALTER TABLE telegram_accounts ADD CONSTRAINT telegram_accounts_telegram_user_key UNIQUE (telegram_user_id);
ALTER TABLE telegram_accounts DROP COLUMN operator_id;
ALTER TABLE clubs DROP COLUMN operator_id;
ALTER TABLE users DROP CONSTRAINT users_id_operator_key;
ALTER TABLE users DROP CONSTRAINT users_operator_telegram_only;
ALTER TABLE users DROP COLUMN operator_id;
DROP TABLE operators;
