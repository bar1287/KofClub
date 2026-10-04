-- Drops every user's two-factor settings (they must enroll again).
ALTER TABLE sessions DROP COLUMN mfa_at;
DROP TABLE user_mfa_recovery_codes;
DROP TABLE user_mfa;
