-- M1 clubs: clubs, memberships with roles, invitations. Owned by the
-- control-api clubs module.

CREATE TABLE clubs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users (id),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 64),
  description   text CHECK (char_length(description) <= 500),
  -- Short shareable code; joining with it grants MEMBER role.
  join_code     text NOT NULL,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clubs_join_code_key UNIQUE (join_code)
);
CREATE INDEX clubs_owner_idx ON clubs (owner_user_id);
CREATE TRIGGER clubs_set_updated_at BEFORE UPDATE ON clubs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE club_members (
  club_id    uuid NOT NULL REFERENCES clubs (id),
  user_id    uuid NOT NULL REFERENCES users (id),
  role       text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'AGENT', 'MEMBER')),
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BANNED', 'LEFT')),
  invite_id  uuid,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);
CREATE INDEX club_members_user_idx ON club_members (user_id) WHERE status = 'ACTIVE';
-- Exactly one owner per club.
CREATE UNIQUE INDEX club_members_single_owner ON club_members (club_id) WHERE role = 'OWNER';
CREATE TRIGGER club_members_set_updated_at BEFORE UPDATE ON club_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE club_invites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    uuid NOT NULL REFERENCES clubs (id),
  created_by uuid NOT NULL REFERENCES users (id),
  -- SHA-256 of the invite code; the plaintext is shown once at creation.
  code_hash  bytea NOT NULL,
  role       text NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MEMBER', 'AGENT')),
  max_uses   integer NOT NULL CHECK (max_uses BETWEEN 1 AND 10000),
  use_count  integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_invites_code_hash_key UNIQUE (code_hash),
  CONSTRAINT club_invites_use_count CHECK (use_count BETWEEN 0 AND max_uses)
);
CREATE INDEX club_invites_club_idx ON club_invites (club_id, created_at DESC);

ALTER TABLE club_members
  ADD CONSTRAINT club_members_invite_fk FOREIGN KEY (invite_id) REFERENCES club_invites (id);
