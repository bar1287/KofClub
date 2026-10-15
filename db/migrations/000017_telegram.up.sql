-- Telegram Mini App sign-in (T1, ADR-018). A Telegram account is linked to
-- at most one user and a user to at most one Telegram account. Users who
-- signed up through Telegram have no email or password (they sign in with
-- Telegram only); everyone else keeps both.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE telegram_accounts (
  user_id           uuid PRIMARY KEY REFERENCES users (id),
  telegram_user_id  bigint NOT NULL CHECK (telegram_user_id > 0),
  telegram_username text CHECK (char_length(telegram_username) <= 64),
  first_name        text CHECK (char_length(first_name) <= 128),
  linked_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_accounts_telegram_user_key UNIQUE (telegram_user_id)
);

-- Every user can sign in somehow: with a password or with Telegram.
CREATE FUNCTION users_have_sign_in() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS NULL AND NOT EXISTS (
    SELECT 1 FROM telegram_accounts t WHERE t.user_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'user % would have no way to sign in', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
-- Deferred: a Telegram user's row and their telegram_accounts row are
-- inserted in the same transaction.
CREATE CONSTRAINT TRIGGER users_sign_in_check AFTER INSERT OR UPDATE OF password_hash ON users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION users_have_sign_in();
