# ADR-017: Two-factor authentication (TOTP) and admin enforcement

Status: Accepted
Date: 2026-10-04

## Context

The security review (docs/security-review.md) requires MFA for platform
administrators before production; the spec asks for "MFA-ready hooks" in
identity. Platform administrators can suspend users and clubs and read audit
and risk data, so a stolen password alone must not be enough. The
constraints are the project's usual ones: no custom cryptography, nothing
secret in logs, PostgreSQL as the source of truth, and the existing
session model (opaque rotating refresh tokens, access JWTs re-checked
against the session row on every request).

## Decision

**Factor.** Time-based one-time passwords (RFC 6238: HMAC-SHA1, 6 digits,
30-second steps, one step of clock tolerance), computed with `node:crypto`
HMAC and verified against the RFC test vectors. Any authenticator app
works; no SMS/e-mail providers. WebAuthn/passkeys are the planned stronger
factor (phishing resistant) and fit the same session flag.

**Enrollment (any user).** `POST /v1/me/mfa/totp` creates a pending
20-byte secret and returns it once (base32 and an `otpauth://` URI).
`POST /v1/me/mfa/totp/confirm {code}` activates it, marks the current
session as verified and returns ten single-use recovery codes, shown once
and stored as SHA-256 hashes (they are 50-bit random values, so a fast hash
is adequate). `POST /v1/me/mfa/totp/disable {code}` removes it (TOTP or
recovery code). `GET /v1/me/mfa` reports the state.

**Secrets at rest.** TOTP secrets are encrypted with AES-256-GCM under
`MFA_ENCRYPTION_KEY_B64` (control-api only), with the user id as associated
data so a ciphertext cannot be moved to another account.

**Login.** `POST /v1/auth/login` accepts an optional `mfaCode`. The
password is checked first, exactly as before; for an account with MFA a
missing code answers `MFA_REQUIRED` (401) and a wrong one `MFA_INVALID`
(401). The client resubmits the same request with the code, so there is no
server-side challenge state. Wrong codes count as failed logins: the
per-account login limit (10 per 15 minutes, kept in memory when Redis is
down) bounds guessing far below the 10^6 code space. A code is accepted
once: the last used time step is stored and older or equal steps are
rejected. Recovery codes are accepted in the same field and consumed.

**Sessions.** `sessions.mfa_at` records that the session was established
with a second factor (login with a code, or enrollment confirmed in that
session). Refresh rotation keeps it. The global auth guard already reads
the session on every request, so the flag costs no extra query.

**Enforcement.** Platform-admin routes require an MFA session
(`MFA_REQUIRED` with `details.enrolled`), so an administrator without MFA is
sent to enroll first. `ADMIN_MFA_REQUIRED=false` exists for local demos and
is refused in production. Club roles do not require MFA (optional
enrollment); a club policy can come later.

**Recovery and audit.** `MFA_ENABLED`, `MFA_DISABLED` and
`MFA_RECOVERY_CODE_USED` are written to the audit log. An operator resets a
user who lost both device and codes with the CLI (`platform-admin
reset-mfa <username>`), which also revokes the user's sessions and is
audited (`MFA_RESET`). There is deliberately no HTTP endpoint for it.

## Consequences

- TOTP can be phished by a real-time relay; WebAuthn is the follow-up.
- `MFA_ENCRYPTION_KEY_B64` is a new required secret for control-api; losing
  it means every user must be reset with the CLI. It has a single key (no
  keyring yet); rotating it means re-enrollment.
- Existing administrators lose console access until they enroll, which is
  the intent; the web console links to enrollment.
- Migration 000012 adds `user_mfa`, `user_mfa_recovery_codes` and
  `sessions.mfa_at`; the down migration drops them (MFA settings are lost).
