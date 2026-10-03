# Security review (M8)

Scope: the whole repository at the end of M8 — control-api, game-service,
realtime-gateway, worker, web client, database schema, CI and container
images. Method: threat-driven review of every trust boundary, code reading,
targeted tests, automated scans. Controls are catalogued in
[security.md](security.md); this document records what was verified, what
was found and what remains.

## Assets and threats

| Asset                        | Main threats                                                        |
| ---------------------------- | ------------------------------------------------------------------- |
| Hidden cards / deck order    | leaking to other players, staff, logs; predicting shuffles          |
| Chip balances (ledger)       | creating/destroying chips, double spending, tampering with history  |
| Game integrity               | acting out of turn, replaying commands, stale/forged state          |
| Accounts and sessions        | credential stuffing, token theft, session fixation, privilege abuse |
| Club/platform administration | unauthorized role changes, silent tampering, over-broad access      |

## Verified controls

| Area               | What was checked                                                                                                                                                                                               | Result |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Card privacy       | Unrevealed cards only in the owner's private payloads; public events/snapshots/event log never contain them (contract and leak tests in Go, API and E2E)                                                       | OK     |
| History privacy    | Own cards decrypted only for (hand, requester); staff/admins get public record; outsiders 404 (integration tests assert no foreign card strings)                                                               | OK     |
| Shuffle            | crypto/rand with rejection sampling (no modulo bias), per-hand salted SHA-256 commitment                                                                                                                       | OK     |
| Ledger integrity   | Single write path `ledger_post()` (zero-sum, non-negative, idempotent refs), append-only triggers, invariant view monitored, restore drill re-verifies                                                         | OK     |
| Command integrity  | Identity from the connection, turn/legal-action validation on the server, `requestId` idempotency (persisted), `expectedSeq` staleness check                                                                   | OK     |
| Ownership fencing  | Every game write in a transaction that locks the lease row and checks the epoch; chaos drill (SIGKILL) shows no double-apply                                                                                   | OK     |
| AuthN              | Argon2id; EdDSA JWT (15 min) with iss/aud/typ; refresh rotation + reuse detection; session/role/status re-read from PostgreSQL on every request                                                                | OK     |
| Browser tokens     | Access token in memory; refresh token HttpOnly + SameSite=Strict + path `/v1/auth`; E2E asserts the cookie is invisible to `document.cookie`                                                                   | OK     |
| CSRF               | APIs require a bearer token header; the only cookie is path-scoped, SameSite=Strict and used only by `/v1/auth/refresh` behind a CORS allowlist                                                                | OK     |
| AuthZ              | Central `ClubAccessService` permission matrix (unit tested), platform-admin guard reading the role from the database, negative integration tests                                                               | OK     |
| Input validation   | zod `.strict()` schemas on every request body (unknown fields rejected), validated query params and UUID path params; Go internal API rejects unknown fields; body size limits (64 KiB HTTP, 64 KiB WS frames) | OK     |
| SQL injection      | All queries parameterized; dynamic SQL limited to whitelisted fragments; admin search escapes LIKE metacharacters (test)                                                                                       | OK     |
| XSS                | React escaping only; no `dangerouslySetInnerHTML`/`eval`; strict nonce CSP (`script-src 'nonce-…' 'strict-dynamic'`, `object-src 'none'`); E2E checks zero CSP violations                                      | OK     |
| Clickjacking       | `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`                                                                                                                                                       | OK     |
| WebSocket          | Origin allowlist, token only in the first frame (never in URLs), HELLO timeout, expiry/revocation close, per-connection command rate limit, bounded queues                                                     | OK     |
| Service-to-service | Internal APIs require a shared token (constant-time compare) and are never routed by the edge                                                                                                                  | OK     |
| Tracing            | Span attributes limited to ids/kinds/counts; SQL without parameters, Redis without arguments, no headers/bodies; a test rejects card-like attribute values                                                     | OK     |
| Logging            | pino redaction of authorization, cookies, passwords and tokens; request serializer logs method/URL/id only; hashed IPs                                                                                         | OK     |
| Secrets            | `.env*`, keys ignored by git; gitleaks over the full history in CI (one reviewed false positive allow-listed)                                                                                                  | OK     |
| Dependencies       | `pnpm audit` (prod and dev): no known vulnerabilities; `govulncheck` runs in CI                                                                                                                                | OK     |
| Containers         | Non-root users, minimal Alpine runtimes, no build tools in runtime images                                                                                                                                      | OK     |

## Findings fixed in M8

1. **Client IP behind a load balancer** (high). `trust proxy` was hard-coded
   to `loopback`; behind an ALB every request would carry the balancer's IP,
   making per-IP rate limits (login 30/5 min, registration 10/h) global — a
   trivial lockout for all users. Now `TRUST_PROXY` (hop count or CIDRs),
   with "trust everything" refused.
2. **No Content-Security-Policy** (medium). Added a per-request nonce CSP
   (`proxy.ts`) plus `Cross-Origin-Opener-Policy`, and HSTS in
   staging/production.
3. **Seating in a suspended club** (medium, found in M7). Seating only
   checked view rights; suspended clubs now refuse buy-ins.
4. **Lease release on shutdown** (low, availability). Drains returned before
   leases were released, so tables waited for the TTL on another node.

## Residual risks and recommendations

- **Rate limiting of reads**: authenticated read endpoints (history,
  lobby, admin search) have no application-level limits; rely on edge rate
  limiting (ALB/WAF) per user/IP.
- **Redis outage** makes the rate limiter fail open (documented tradeoff);
  Argon2 cost still bounds password guessing. Consider an in-process
  fallback limiter for login.
- **XSS impact**: a script running in the page can act as the user while the
  page is open (inherent to browser sessions); the CSP makes injection
  substantially harder but `style-src 'unsafe-inline'` remains for React
  style attributes.
- **Deck-key compromise** would expose stored hole cards of past hands; keep
  `DECK_ENCRYPTION_KEY_B64` only on game nodes, rotate with a key id prefix
  before production (not yet implemented).
- **No MFA** for platform administrators yet (spec lists MFA-ready hooks);
  required before production for admin accounts.
- **Collusion/fraud detection** is limited to the risk-event plumbing and
  review queue; behavioral detectors are future work (spec §11).
