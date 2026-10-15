DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE email IS NULL OR password_hash IS NULL) THEN
    RAISE EXCEPTION 'users who sign in only with Telegram exist; they would lose access';
  END IF;
END
$$;
DROP TRIGGER users_sign_in_check ON users;
DROP FUNCTION users_have_sign_in();
DROP TABLE telegram_accounts;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
