# Security

Security controls from spec §9, and how they are implemented.

| Control                 | Implementation                                                                                                                                          | Status     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Passwords               | Argon2id (`argon2` npm) with memory 19 MiB, t=2, p=1 (OWASP baseline)                                                                                   | M1         |
| Access token            | EdDSA (Ed25519) JWT, 15 min, `iss`/`aud` enforced, `sid` claim                                                                                          | M1         |
| Refresh token           | 256-bit opaque random, SHA-256 hashed at rest, rotation on every use, reuse detection revokes the session                                               | M1         |
| Session/device tracking | `sessions` rows with device id, hashed IP, user agent, last seen; users can list/revoke                                                                 | M1         |
| WebSocket auth          | Access token in the first `HELLO` frame only; connection closed when the token expires unless re-authenticated                                          | M5         |
| RBAC                    | PlatformAdmin, ClubOwner, ClubAdmin, ClubAgent, Member; checked server-side per request                                                                 | M1         |
| Object authorization    | Every club/table query and command checks membership/status (tenant isolation)                                                                          | M1+        |
| Rate limiting           | Redis fixed-window counters per IP + account + endpoint                                                                                                 | M1         |
| Replay protection       | Command `commandId` dedupe per table; refresh-token rotation                                                                                            | M1/M5      |
| Audit                   | Append-only `audit_log` for privileged actions                                                                                                          | M1         |
| Secrets                 | Environment variables locally; managed secret store in deployed environments; nothing secret in git                                                     | M0         |
| Card privacy            | ADR-008: no unrevealed cards outside the game node; encrypted at rest                                                                                   | M4         |
| Logging ban             | Never log hole cards (before hand completion), deck order, passwords, refresh tokens, Authorization headers, private user data. pino redaction + review | M0+        |
| Transport               | TLS 1.2+ terminated at the edge/load balancer; HSTS on the web tier                                                                                     | deployment |

## Secrets

- Local: `scripts/init-env.sh` generates `.env` (gitignored) with an Ed25519
  key pair, the internal service token, the IP-hash pepper and the deck
  encryption key.
- Deployed environments: inject the same variables from AWS Secrets Manager /
  SSM Parameter Store (or equivalent). Rotate keys by deploying the new
  public key alongside the old one (verification accepts both) before
  switching the signing key.
- Never commit `.env`, keys or tokens. `.gitignore` blocks `.env*`, `*.pem`, `*.key`.

## Internal service authentication

control-api → game-service and realtime-gateway → game-service calls carry
`Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` and are only reachable on
the private network. The token is compared in constant time. Internal
endpoints live under `/internal/v1` and are never exposed by the edge.

## Reporting

Suspicious-login and abuse signals are written as structured security
events (`security_event` log lines + `security_events_total` metric) and,
where relevant, `risk_events` rows for later review (spec §11).
