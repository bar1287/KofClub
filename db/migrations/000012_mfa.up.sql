-- Two-factor authentication (ADR-017): TOTP secrets (encrypted by the
-- control-api, AES-256-GCM, user id as associated data), single-use recovery
-- codes (SHA-256 hashes) and the sessions established with a second factor.
CREATE TABLE user_mfa (
  user_id         uuid PRIMARY KEY REFERENCES users (id),
  totp_secret_enc bytea NOT NULL,
  -- NULL while enrollment is pending (secret issued, not yet confirmed).
  enabled_at      timestamptz,
  -- Last accepted TOTP time step: a code is accepted at most once.
  last_used_step  bigint NOT NULL DEFAULT 0 CHECK (last_used_step >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER user_mfa_set_updated_at BEFORE UPDATE ON user_mfa
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_mfa_recovery_codes (
  user_id    uuid NOT NULL REFERENCES users (id),
  code_hash  bytea NOT NULL CHECK (octet_length(code_hash) = 32),
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);

-- Set when the session was established with a second factor; kept across
-- refresh-token rotation.
ALTER TABLE sessions ADD COLUMN mfa_at timestamptz;
