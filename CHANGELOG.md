# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — M2 Pure Hold'em engine

- `go/poker`: card model, crypto-secure Fisher–Yates shuffle with unbiased
  sampling, deck commitment hash.
- Bitmask 7-card evaluator with best-five selection; exhaustive 5-card and
  opt-in exhaustive 7-card verification; reference cross-check.
- No-limit Hold'em state machine: blinds (incl. heads-up and short blinds),
  dealing, streets, legal-action model, min-raise and incomplete-all-in
  reopening rules, uncalled-bet return, all-in runouts, showdown, side pots,
  split pots with odd-chip rule, timeout default action, typed errors.
- `Table`: seating, sitting out, button rotation, joining between hands,
  hand abort with stack restoration, restore from durable state.
- Property tests over 12,000 random hands and dependency-boundary test.

### Added — M1 Identity + Clubs

- Migrations: `users`, `sessions`, `session_refresh_tokens`, `audit_log`,
  `risk_events`, `idempotency_keys`, `clubs`, `club_members`, `club_invites`.
- Auth: register/login/refresh/logout with Argon2id, EdDSA access tokens,
  rotating opaque refresh tokens with reuse detection (session revocation),
  optional HttpOnly cookie transport for browsers, session listing/revocation.
- Clubs: create, list, details, join by club code or invite code, leave,
  join-code rotation, members (keyset pagination), role/status changes with a
  role hierarchy, invites (hashed, expiring, max uses, revocable).
- RBAC permission matrix (OWNER/ADMIN/AGENT/MEMBER + platform-admin read-only
  oversight) and central tenant-isolation check.
- Append-only audit log for privileged actions; risk events for new-device
  logins and refresh-token reuse; security-event metrics.
- Redis rate limiting (IP, account and endpoint dimensions) and generic
  `Idempotency-Key` support for mutations.
- OpenAPI contract for all M1 endpoints; integration tests validate responses
  against it. Demo seed (`make seed`). Worker job purging idempotency keys.

### Fixed

- Keyset pagination cursors now keep microsecond precision (rows were
  repeated across pages).

### Added — M0 Foundation

- Monorepo layout per spec §5: pnpm workspace + single Go module.
- `make` targets for bootstrap, dev (Docker Compose), deps, migrate, seed, fmt,
  lint, typecheck, test, integration, e2e, contracts, load-smoke.
- Docker Compose stack: PostgreSQL 16, Redis 7, one-shot migrations,
  control-api, realtime-gateway, game-service, worker, web.
- Dockerfiles for Go (`infra/docker/go.Dockerfile`) and Node
  (`infra/docker/node.Dockerfile`) deployables.
- SQL migration runner (`go/cmd/migrate`, golang-migrate, embedded migrations)
  and foundation migration (extensions, `set_updated_at`, `reject_mutation`).
- Contracts package: OpenAPI baseline (error envelope + error-code catalogue,
  health), realtime schema baseline, TS (openapi-typescript) and Go
  (oapi-codegen) generation with CI drift check.
- `/health/live`, `/health/ready` and `/metrics` on every deployable;
  structured JSON logging with request ids; graceful draining.
- Validated configuration (zod / `go/envconfig`), `.env.example`,
  `scripts/init-env.sh` secret generation.
- GitHub Actions CI: lint, typecheck, unit tests, contract drift,
  integration tests against PostgreSQL/Redis, migration round-trip, image builds.
- Documentation: README, AGENTS.md, PROJECT_STATUS.md, architecture,
  database, security, deployment docs and ADR-001…011.
