# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — M6 Web poker table

- Web client (Next.js): register/login/logout, session restore from the
  HttpOnly refresh cookie, clubs (create, join by code), club lobby (wallet,
  tables, members, staff table creation and chip grants), profile with
  device sign-out, and the poker table (seats around the felt, stacks, bets,
  dealer/blind markers, own hole cards, face-down opponents, board, pot,
  turn timer, legal-action bar with bet presets, buy-in dialog, sit out/in,
  leave, action log, last-hand results, deck commitment).
- Reference realtime client: HELLO/AUTH token refresh, exponential backoff
  with jitter, resume with `lastSeenSeq`, idempotent command re-send after
  reconnects, heartbeats; pure table-state reducer with strict seq ordering
  and resync (ADR-012).
- API client with single-flight, cross-tab (Web Locks) refresh-token rotation.
- `make e2e` / `scripts/e2e.sh`: fresh database, all services started
  natively, Playwright two-browser vertical slice (full hand, private cards,
  reload mid-hand, table/wallet reconciliation) and auth-flow spec; CI job.
- `go/cmd/devdb`: recreates the e2e database (refuses outside local/test).
- Docs: `docs/web-client.md`, ADR-012.

### Fixed

- game-service: a graceful drain now waits until every table lease is
  released before the process closes its database pool, so another node
  adopts the tables immediately instead of after the lease TTL (previously
  releases failed with "context canceled" at shutdown).
- Web: logging out from a protected page no longer bounces through
  `/login?next=…`.

### Added — M5 Realtime

- realtime-gateway: WebSocket protocol (HELLO/WELCOME, AUTH token refresh,
  SUBSCRIBE_TABLE with snapshot/replay/resync, TABLE_EVENT with per-viewer
  private payloads, COMMAND/COMMAND_RESULT, PING/PONG, ERROR); EdDSA token
  verification (public key only), Redis revocation check and live session
  termination; control-api-backed table authorization with caching;
  per-table feeds with replay ring, gap detection and reset; bounded send
  queues; drain on shutdown; metrics.
- game-service: internal WebSocket event stream with backlog replay.
- control-api: `/internal/v1/tables/{id}/access` (service token) for the gateway.
- realtime.yaml: complete client/server frame and event payload schemas.
- Tests: Go contract test of all event payloads/snapshots; gateway
  end-to-end suite with a real game-service process (identical ordered
  streams, private card isolation, replay, resync outside the window,
  idempotent commands, stale seq, unauthorized subscription, auth/close
  codes, revocation) with every frame validated against realtime.yaml.

### Fixed

- Gateway close codes: explicit HELLO timeout (4408) and failure close
  codes are no longer replaced by a normal closure.

### Added — M4 Table service

- Migration `000006_tables`: tables, leases, runtime, seats, hands, hand
  players (encrypted hole cards), append-only game events and command log.
- game-service: PostgreSQL lease manager with epoch fencing; table actor
  (serialized inbox, clone→apply→persist→swap commit pipeline, turn timers
  with check/fold defaults and auto sit-out, buy-in/cash-out through the
  ledger, leave-after-hand, busted-player removal, atomic hand settlement
  with ledger/seat consistency assertion); crypto shuffle with deck
  commitment and AES-256-GCM encrypted deck/hole cards; failover by
  deterministic replay (void fallback); registry with orphan adoption,
  renewal, idle stop and draining; internal HTTP API; Prometheus metrics.
- control-api: table directory (create/list/detail), seat/leave forwarding
  to the owning game node, table state snapshot; OpenAPI + realtime
  TableSnapshot schema.
- Engine: `Table.Clone()` and `Table.ResumeHand()`.
- Tests: actor integration suite (full hands, privacy, idempotency, stale
  seq, timeouts, leaving, buy-in rules, failover replay, fencing, void on
  corrupt state, ordered streams, multi-hand conservation; race detector
  clean) and control-api integration against a real game-service process.

### Fixed

- Auto sit-out after repeated timeouts was skipped when the timeout action
  ended the hand (always the case heads-up).

### Added — M3 Ledger

- Migration `000005_ledger`: per-club accounts (treasury, member wallets,
  table stacks), immutable transactions/entries, `ledger_post()` enforcing
  zero-sum, idempotency, non-negative balances, per-kind flows and
  deterministic locking; `ledger_reverse()`; deferred zero-sum trigger;
  balance-projection guard; `ledger_invariant_violations` view.
- `go/ledger-client` (Go) and `LedgerRepository` (TS) over the same SQL API.
- Chip administration API: wallet + history, grants, deductions, reversals,
  circulation summary, member balances, transaction log; audit + risk events.
- Worker job monitoring ledger invariants (`ledger_invariant_violations` gauge)
  and a worker `/metrics` endpoint. Demo seed grants chips idempotently.

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
