# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — M9 Pot-Limit Omaha

- Engine rule modules (ADR-015): `GameType` (`NLHE`, `PLO`) selects hole-card
  count, hand evaluation and betting limit; blinds, turn order, side pots,
  settlement and recovery are shared.
- `EvaluateOmaha` (exactly two hole cards + three board cards), cross-checked
  against the reference evaluator; pot-limit caps (`currentBet + pot +
toCall`) in legal actions and validation; all-in only within the limit.
- Property tests run 8,000 random PLO hands with the NLHE invariants; table
  session tests for both games.
- Migration 000008: `tables.game_type` accepts `PLO`; `hands.game_type`.
- Contracts: `GameType` on `TableInfo`, `HAND_STARTED`, `Table`,
  `CreateTableRequest` (default `NLHE`) and `HandSummary`; card arrays of 2
  or 4.
- Game service: PLO tables deal/seal 4 cards, replay after failover as PLO,
  history decrypts 4 cards; control-api creates PLO tables and lists the game
  in history.
- Web: game selector when creating tables, game labels (lobby, admin,
  table header, history), 4 card backs for opponents, pot-limit sizing
  ("Pot" is the maximum; a capped raise is never sent as all-in).
- Tests: game-service PLO integration (4 private cards, pot limit, failover,
  history, contract), control-api PLO integration, Playwright PLO hand;
  `make load-smoke ARGS="-game MIXED"` (CI runs mixed tables).

### Added — M8 Hardening

- Chaos drill (`tests/chaos`, in `make integration`): SIGKILL a game node
  mid-hand; another node adopts the table and finishes the same hand with
  identical state, a gap-free event log and exact chip conservation.
- Load smoke (`make load-smoke`): bots over the real HTTP/WebSocket APIs;
  latency percentiles, rejections, resyncs and a ledger reconciliation check.
- Backup/restore scripts and drill (`make backup-restore-check`).
- OpenTelemetry tracing (ADR-014): one trace per player action from
  WebSocket ingress through the game command, fenced persistence and ledger
  posting to the broadcast; control-api → game-service traces; `trace_id` in
  logs; Jaeger in `make observability`; `make trace-check` verifies the span
  tree.
- Security: per-request nonce CSP, COOP, HSTS (staging/production),
  `TRUST_PROXY`, `make audit` (npm + govulncheck), gitleaks in CI,
  docs/security-review.md.
- CI: security, ops-drills and Compose + browser E2E jobs.
- Runbooks: backup/restore, failover drill; docs/performance.md.

### Fixed

- Docker Compose: the gateway had no `CONTROL_API_INTERNAL_URL`, so every
  table subscription in the containerized stack was refused.
- HTTP metrics were labelled `route="unmatched"` for every request (the
  pattern was read from the wrong request copy).
- Behind a load balancer, per-IP rate limits would have applied to all users
  together (`trust proxy` was hard-coded to loopback).

### Added — M7 History + Admin

- Hand history: `GET /v1/me/hands`, `GET /v1/hands/{id}`,
  `GET /v1/clubs/{id}/hands` with the ADR-008 visibility policy
  (participants: public record + own hole cards; staff: public record only;
  others: 404). Own hole cards are decrypted by the game plane
  (`/internal/v1/hands/{id}/hole-cards`); the key never leaves it.
- Table closure: `POST /v1/tables/{id}/close`; the actor stops dealing,
  announces `TABLE_CLOSED` and cashes every seat out once no hand is running
  (`PLAYER_LEFT` reason `TABLE_CLOSED`); converges after lost notifications
  and restarts.
- Club administration: `PATCH /v1/clubs/{id}` (settings),
  `POST /v1/clubs/{id}/transfer-ownership`; web console
  (`/clubs/{id}/admin`) for members/roles/bans/ownership, invites, chips and
  ledger (grants, deductions, reversals), tables, hands, audit log, settings.
- Platform administration (`/v1/admin/*`, web `/admin`): overview,
  account/club search with suspension (sessions revoked at once; suspended
  clubs are view-only), platform-wide audit log, risk-case review with
  immutable evidence; operator CLI `make platform-admin` (audited).
- Web: `/hands` and hand detail pages with the replayed public action log.
- Observability: Prometheus scrape config, 8 alert rules (promtool-checked),
  provisioned Grafana dashboard (`make observability`), runbooks for every
  alert, `docs/observability.md`.
- Migration `000007_history_admin`; ADR-013; E2E spec for the club console.

### Fixed

- Seating in a suspended club was possible (seat only checked view rights).
- CI's migration step now really rolls back and re-applies the latest migration.

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
