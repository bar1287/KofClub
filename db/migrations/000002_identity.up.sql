-- M1 identity: users, sessions (one per device login) and rotated refresh
-- token history for reuse detection. Owned by control-api identity module.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL,
  username      citext NOT NULL,
  password_hash text NOT NULL,
  status        text NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  platform_role text NOT NULL DEFAULT 'USER'
                CHECK (platform_role IN ('USER', 'PLATFORM_ADMIN')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_username_key UNIQUE (username),
  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9_]{3,24}$'),
  CONSTRAINT users_email_length CHECK (char_length(email) BETWEEN 3 AND 254)
);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id),
  -- SHA-256 of the current opaque refresh token (never the token itself).
  refresh_hash  bytea NOT NULL,
  device_id     text CHECK (char_length(device_id) <= 128),
  user_agent    text CHECK (char_length(user_agent) <= 512),
  -- HMAC of the client IP with a server-side pepper (privacy, spec §6).
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoke_reason text CHECK (revoke_reason IN ('LOGOUT', 'USER_REVOKED', 'REFRESH_REUSE', 'ADMIN', 'ACCOUNT_SUSPENDED')),
  CONSTRAINT sessions_refresh_hash_key UNIQUE (refresh_hash)
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id, created_at DESC) WHERE revoked_at IS NULL;

-- Refresh tokens that have already been rotated. Presenting one again means
-- the token was stolen or replayed: the whole session is revoked.
CREATE TABLE session_refresh_tokens (
  token_hash bytea PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  rotated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_refresh_tokens_session_idx ON session_refresh_tokens (session_id);
