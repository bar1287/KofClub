DROP INDEX IF EXISTS clubs_name_prefix_idx;
DROP INDEX IF EXISTS users_email_prefix_idx;
DROP INDEX IF EXISTS users_username_prefix_idx;
ALTER TABLE risk_events DROP COLUMN IF EXISTS review_note;
DROP INDEX IF EXISTS hands_club_history_idx;
