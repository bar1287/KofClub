-- Table chat (roadmap W1.4). control-api owns chat: it checks that the
-- sender may talk at the table, stores messages (purged after a retention
-- period by the worker) and handles reports; the realtime gateway only
-- carries them. Emoji reactions are not stored.
ALTER TABLE clubs ADD COLUMN table_chat boolean NOT NULL DEFAULT true;

CREATE TABLE chat_messages (
  id         uuid PRIMARY KEY,
  club_id    uuid NOT NULL REFERENCES clubs (id),
  table_id   uuid NOT NULL REFERENCES tables (id),
  user_id    uuid NOT NULL REFERENCES users (id),
  -- The sender's CHAT_SEND requestId: a retried send is stored once.
  request_id uuid NOT NULL,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 200),
  -- Set when club staff hide the message after a report.
  hidden_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
CREATE INDEX chat_messages_table_idx ON chat_messages (table_id, created_at DESC);
CREATE INDEX chat_messages_created_idx ON chat_messages (created_at);

-- A report keeps its own copy of the message: messages are purged.
CREATE TABLE chat_reports (
  id               uuid PRIMARY KEY,
  club_id          uuid NOT NULL REFERENCES clubs (id),
  table_id         uuid NOT NULL REFERENCES tables (id),
  message_id       uuid NOT NULL,
  reported_user_id uuid NOT NULL REFERENCES users (id),
  reporter_user_id uuid NOT NULL REFERENCES users (id),
  body             text NOT NULL,
  reason           text CHECK (char_length(reason) <= 200),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DISMISSED', 'HIDDEN')),
  resolved_by      uuid REFERENCES users (id),
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, reporter_user_id)
);
CREATE INDEX chat_reports_club_idx ON chat_reports (club_id, status, created_at DESC);
