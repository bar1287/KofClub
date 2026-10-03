-- M7 hand history: club-wide (staff audit) listing, newest first. Hand ids
-- are UUIDv7, so ordering by id is chronological and serves keyset paging.
CREATE INDEX hands_club_history_idx ON hands (club_id, id DESC) WHERE status <> 'IN_PROGRESS';

-- M7 platform administration.
-- Reviewer's explanation for a risk-case disposition (evidence columns stay
-- immutable; the risk_events_guard trigger only allows review fields to change).
ALTER TABLE risk_events ADD COLUMN review_note text CHECK (char_length(review_note) <= 1000);

-- Prefix search for accounts and clubs in the admin console.
CREATE INDEX users_username_prefix_idx ON users (lower(username::text) text_pattern_ops);
CREATE INDEX users_email_prefix_idx ON users (lower(email::text) text_pattern_ops);
CREATE INDEX clubs_name_prefix_idx ON clubs (lower(name) text_pattern_ops);
