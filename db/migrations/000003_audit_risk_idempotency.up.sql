-- Append-only audit log of privileged actions (spec §9).
CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users (id),
  club_id       uuid,
  action        text NOT NULL,
  object_type   text NOT NULL,
  object_id     text,
  before_json   jsonb,
  after_json    jsonb,
  request_id    text,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_club_idx ON audit_log (club_id, created_at DESC) WHERE club_id IS NOT NULL;
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, created_at DESC);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Risk/fair-play signals for later review (spec §11). Only the review
-- columns may change after insert.
CREATE TABLE risk_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid REFERENCES users (id),
  club_id         uuid,
  type            text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  score           integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  feature_values  jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs   jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_version   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid REFERENCES users (id),
  disposition     text CHECK (disposition IN ('DISMISSED', 'CONFIRMED', 'ESCALATED'))
);
CREATE INDEX risk_events_subject_idx ON risk_events (subject_user_id, created_at DESC);
CREATE INDEX risk_events_open_idx ON risk_events (created_at DESC) WHERE reviewed_at IS NULL;

CREATE FUNCTION risk_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'risk_events is append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.subject_user_id, NEW.club_id, NEW.type, NEW.severity, NEW.score, NEW.feature_values,
      NEW.evidence_refs, NEW.model_version, NEW.created_at)
     IS DISTINCT FROM
     (OLD.subject_user_id, OLD.club_id, OLD.type, OLD.severity, OLD.score, OLD.feature_values,
      OLD.evidence_refs, OLD.model_version, OLD.created_at) THEN
    RAISE EXCEPTION 'risk_events evidence is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER risk_events_guard BEFORE UPDATE OR DELETE ON risk_events
  FOR EACH ROW EXECUTE FUNCTION risk_events_guard();

-- Idempotency records for retried HTTP requests (Idempotency-Key header).
CREATE TABLE idempotency_keys (
  user_id       uuid NOT NULL REFERENCES users (id),
  key           text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  method        text NOT NULL,
  path          text NOT NULL,
  request_hash  text NOT NULL,
  status_code   integer,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
