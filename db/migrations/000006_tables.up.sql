-- M4 tables and game persistence.
--
-- Ownership: `tables` (configuration) is written by the control-api table
-- directory module; everything else here is written only by the
-- game-service under a lease epoch (ADR-002).

CREATE TABLE tables (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id           uuid NOT NULL REFERENCES clubs (id),
  name              text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 64),
  game_type         text NOT NULL DEFAULT 'NLHE' CHECK (game_type IN ('NLHE')),
  max_seats         integer NOT NULL CHECK (max_seats BETWEEN 2 AND 10),
  small_blind       bigint NOT NULL CHECK (small_blind > 0),
  big_blind         bigint NOT NULL,
  buyin_min         bigint NOT NULL,
  buyin_max         bigint NOT NULL,
  action_timeout_ms integer NOT NULL DEFAULT 20000 CHECK (action_timeout_ms BETWEEN 5000 AND 120000),
  status            text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_by        uuid NOT NULL REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tables_blinds CHECK (big_blind >= small_blind AND big_blind <= 1000000000000),
  CONSTRAINT tables_buyin CHECK (buyin_min >= big_blind AND buyin_max >= buyin_min AND buyin_max <= 1000000000000000)
);
CREATE INDEX tables_club_idx ON tables (club_id, created_at);
CREATE TRIGGER tables_set_updated_at BEFORE UPDATE ON tables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_table_fk FOREIGN KEY (table_id) REFERENCES tables (id);

-- Single-owner lease with a fencing epoch (ADR-002).
CREATE TABLE table_leases (
  table_id      uuid PRIMARY KEY REFERENCES tables (id),
  owner_node_id text NOT NULL,
  owner_url     text NOT NULL,
  epoch         bigint NOT NULL CHECK (epoch > 0),
  expires_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Durable table-level runtime state (restored on failover).
CREATE TABLE table_runtime (
  table_id     uuid PRIMARY KEY REFERENCES tables (id),
  last_hand_no bigint NOT NULL DEFAULT 0,
  button_seat  integer NOT NULL DEFAULT 0,
  last_seq     bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE table_seats (
  table_id     uuid NOT NULL REFERENCES tables (id),
  seat_no      integer NOT NULL CHECK (seat_no BETWEEN 1 AND 10),
  user_id      uuid NOT NULL REFERENCES users (id),
  -- Projection of the player's TABLE_STACK ledger balance at hand boundaries.
  stack_cached bigint NOT NULL CHECK (stack_cached >= 0),
  sitting_out  boolean NOT NULL DEFAULT false,
  seated_at    timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, seat_no),
  CONSTRAINT table_seats_one_seat_per_user UNIQUE (table_id, user_id)
);
CREATE INDEX table_seats_user_idx ON table_seats (user_id);

CREATE TABLE hands (
  id              uuid PRIMARY KEY,
  table_id        uuid NOT NULL REFERENCES tables (id),
  club_id         uuid NOT NULL REFERENCES clubs (id),
  hand_no         bigint NOT NULL CHECK (hand_no > 0),
  status          text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'VOIDED')),
  button_seat     integer NOT NULL,
  small_blind     bigint NOT NULL,
  big_blind       bigint NOT NULL,
  board           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- SHA-256(salt || deck order); the deck itself is encrypted at rest.
  deck_commitment text NOT NULL,
  deck_enc        bytea NOT NULL,
  lease_epoch     bigint NOT NULL,
  result_hash     text,
  void_reason     text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  CONSTRAINT hands_table_hand_no_key UNIQUE (table_id, hand_no),
  CONSTRAINT hands_completion CHECK ((status = 'IN_PROGRESS') = (ended_at IS NULL))
);
CREATE INDEX hands_table_idx ON hands (table_id, hand_no DESC);
CREATE INDEX hands_in_progress_idx ON hands (table_id) WHERE status = 'IN_PROGRESS';

CREATE TABLE hand_players (
  hand_id        uuid NOT NULL REFERENCES hands (id),
  user_id        uuid NOT NULL REFERENCES users (id),
  seat_no        integer NOT NULL,
  starting_stack bigint NOT NULL CHECK (starting_stack > 0),
  ending_stack   bigint CHECK (ending_stack >= 0),
  contributed    bigint,
  won            bigint,
  net            bigint,
  folded         boolean,
  -- Hole cards encrypted at rest (ADR-008); revealed cards are public.
  hole_cards_enc bytea NOT NULL,
  shown_cards    jsonb,
  PRIMARY KEY (hand_id, user_id),
  CONSTRAINT hand_players_seat_key UNIQUE (hand_id, seat_no)
);
CREATE INDEX hand_players_user_idx ON hand_players (user_id, hand_id);

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_hand_fk FOREIGN KEY (hand_id) REFERENCES hands (id);

-- Ordered, append-only public event log per table (spec §6). Private
-- payloads (hole cards) are never stored here.
CREATE TABLE game_events (
  table_id     uuid NOT NULL REFERENCES tables (id),
  seq          bigint NOT NULL CHECK (seq > 0),
  hand_id      uuid REFERENCES hands (id),
  event_id     uuid NOT NULL,
  event_type   text NOT NULL,
  payload_json jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, seq),
  CONSTRAINT game_events_event_id_key UNIQUE (event_id)
);
CREATE INDEX game_events_hand_idx ON game_events (hand_id, seq) WHERE hand_id IS NOT NULL;
CREATE TRIGGER game_events_append_only BEFORE UPDATE OR DELETE ON game_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Accepted player commands (idempotency across restarts: a command id is
-- applied at most once per table).
CREATE TABLE table_commands (
  table_id   uuid NOT NULL REFERENCES tables (id),
  command_id uuid NOT NULL,
  user_id    uuid NOT NULL REFERENCES users (id),
  hand_id    uuid REFERENCES hands (id),
  kind       text NOT NULL,
  amount     bigint,
  seq        bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id, command_id)
);
CREATE TRIGGER table_commands_append_only BEFORE UPDATE OR DELETE ON table_commands
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
