-- Operators (T3, ADR-019): anyone can run KofClub under their own Telegram
-- bot. Each operator is a separate world: its players and clubs never meet
-- another operator's. Rows with a NULL operator_id belong to KofClub's own
-- world, so existing data is unchanged.
CREATE TABLE operators (
  id            uuid PRIMARY KEY,
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 48),
  owner_user_id uuid NOT NULL REFERENCES users (id),
  status        text NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED')),
  bot_id        bigint NOT NULL CHECK (bot_id > 0),
  bot_username  text NOT NULL CHECK (bot_username ~ '^[A-Za-z0-9_]{5,32}$'),
  -- The bot token, AES-256-GCM sealed (OPERATOR_SECRET_KEY_B64); never logged.
  bot_token_sealed bytea NOT NULL,
  -- SHA-256 of the webhook secret Telegram sends back (set when connected).
  webhook_secret_hash text,
  status_reason text CHECK (char_length(status_reason) <= 200),
  terms_accepted_at timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES users (id),
  CONSTRAINT operators_slug_key UNIQUE (slug),
  CONSTRAINT operators_bot_key UNIQUE (bot_id)
);
CREATE INDEX operators_owner_idx ON operators (owner_user_id);
CREATE INDEX operators_status_idx ON operators (status, created_at DESC);

ALTER TABLE users ADD COLUMN operator_id uuid REFERENCES operators (id);
-- Operator worlds sign in with the operator's bot only.
ALTER TABLE users ADD CONSTRAINT users_operator_telegram_only
  CHECK (operator_id IS NULL OR (email IS NULL AND password_hash IS NULL));
ALTER TABLE users ADD CONSTRAINT users_id_operator_key UNIQUE (id, operator_id);
CREATE INDEX users_operator_idx ON users (operator_id) WHERE operator_id IS NOT NULL;

ALTER TABLE clubs ADD COLUMN operator_id uuid REFERENCES operators (id);
CREATE INDEX clubs_operator_idx ON clubs (operator_id) WHERE operator_id IS NOT NULL;

-- A Telegram user has one account per world.
ALTER TABLE telegram_accounts ADD COLUMN operator_id uuid REFERENCES operators (id);
ALTER TABLE telegram_accounts DROP CONSTRAINT telegram_accounts_telegram_user_key;
ALTER TABLE telegram_accounts ADD CONSTRAINT telegram_accounts_telegram_user_key
  UNIQUE NULLS NOT DISTINCT (operator_id, telegram_user_id);
-- The link is in its user's world.
ALTER TABLE telegram_accounts ADD CONSTRAINT telegram_accounts_user_operator_fkey
  FOREIGN KEY (user_id, operator_id) REFERENCES users (id, operator_id);

-- Clubs and their members are always in the same world.
CREATE FUNCTION same_world_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  club_world uuid;
  user_world uuid;
  member uuid;
BEGIN
  IF TG_TABLE_NAME = 'clubs' THEN
    member := NEW.owner_user_id;
    club_world := NEW.operator_id;
  ELSE
    member := NEW.user_id;
    SELECT operator_id INTO club_world FROM clubs WHERE id = NEW.club_id;
  END IF;
  SELECT operator_id INTO user_world FROM users WHERE id = member;
  IF club_world IS DISTINCT FROM user_world THEN
    RAISE EXCEPTION 'user % and club are in different operator worlds', member
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clubs_same_world BEFORE INSERT OR UPDATE OF owner_user_id, operator_id ON clubs
  FOR EACH ROW EXECUTE FUNCTION same_world_check();
CREATE TRIGGER club_members_same_world BEFORE INSERT OR UPDATE OF user_id, club_id ON club_members
  FOR EACH ROW EXECUTE FUNCTION same_world_check();
