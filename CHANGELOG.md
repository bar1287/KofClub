# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — Pre-actions (roadmap W1.1)

- While others act, a player in the hand can queue Check/Fold, Check or Call
  any (nothing to call), or Fold, Call _amount_ or Call any (facing a bet).
  The choice is sent as an ordinary command when the turn starts, so the
  server still validates it, or dropped if it no longer fits: every
  pre-action ends with its street, Check when a bet is made and Call when
  the amount changes.
- docs/roadmap.md: the plan beyond M10 (W1–W7).

### Fixed — Seat not shown after buying in at a new table

- The realtime gateway sent a table's first snapshot before its event stream
  from game-service had connected (the stream connects after an owner lookup
  that can activate the table). An event committed in that window was never
  delivered, and with no later event nothing revealed the gap: a player who
  bought in right after opening a new table did not see their seat until
  another player joined. This was the intermittent Playwright failure in CI
  (Omaha test). Snapshots now wait until the stream is live (up to 10 s, then
  `TABLE_UNAVAILABLE` and the client resubscribes); a gateway integration
  test delays the stream and checks the event arrives.
- The buy-in dialog replaced an amount the player had already typed with its
  default (the wallet balance, capped at the table maximum) when the wallet
  response arrived late, so the player bought in for more than they typed.
  A typed amount is now kept; the Omaha browser test holds the wallet
  response until the amount is typed to check it.

### Changed — Windows demo diagnostics

- When a step fails, `demo.cmd` writes `demo-log.txt` (Windows and Docker
  versions, `docker info`, port use and Windows-reserved ports, the build
  output, container states and logs; never `.env`) and keeps the window open.
  When the Docker engine does not start, the log has Docker Desktop's state
  (`docker desktop status`, contexts, WSL distributions, its processes and
  the end of its backend log). `.\demo.cmd diagnose` writes it at any time;
  the script prints its version first. On success it opens the site.
- `demo.cmd` checks that the `docker` command actually runs (`where` found
  one that Windows could not run, and the script then waited six minutes
  for an "engine" it could not reach). It falls back to Docker Desktop's
  `resources\bin` folder, and otherwise says that the command is missing
  (restart Windows or reinstall Docker Desktop) and logs `where docker`,
  that folder and PATH.

### Fixed — Running the demo on a fresh machine

- The web image failed to build from a fresh clone (`apps/web/public` was an
  empty directory git does not keep); it now holds `robots.txt`.
- Windows: `demo.cmd` (PowerShell or cmd, only Docker Desktop needed) starts
  Docker Desktop if needed, creates `.env` in a container and runs the demo.
- `.env` generation is one cross-platform Node script (`scripts/init-env.mjs`)
  that runs with a local Node or in the node image, so macOS's LibreSSL
  (no Ed25519) and CRLF checkouts no longer break it; `.gitattributes` keeps
  LF line endings.
- `make demo` publishes only ports 3000, 4000 and 4100 (no clash with a local
  PostgreSQL or Redis).
- CI runs on every branch; it showed the problems above, CI database
  credentials that `.env` overrode, and 24 Go standard-library
  vulnerabilities fixed by moving to Go 1.26.6. CI's Compose job builds the
  stack with `make demo` and runs Playwright against it.

### Added — Demo and screenshots

- `make demo`: the Docker stack plus demo accounts (alice, bob, carol) seeded
  inside the control-api container; CI's Compose job runs it.
- `make screenshots`: a Playwright tour of the real stack and demo data
  (cash hand, phone layout, history, sit-and-go, club and platform admin,
  two-factor setup) saved to docs/screenshots with a gallery page.

### Fixed — Phone layout

- The table page no longer overflows phone screens (grid column could not
  shrink); on screens up to 640px the felt is a portrait oval with smaller
  seats and cards, the top bar wraps, data tables scroll inside their panel,
  and lobby table names link to the table.

### Security

- Two-factor authentication (ADR-017): TOTP (RFC 6238 on node:crypto) with
  ten single-use recovery codes, secrets encrypted at rest
  (`MFA_ENCRYPTION_KEY_B64`), codes accepted once, login asks for the code
  after the password (`mfaCode`, `MFA_REQUIRED`/`MFA_INVALID`), sessions
  record the second factor (migration 000012). Platform administration and
  club oversight require an MFA session (also for the gateway's table access
  check, which now passes the session id); `ADMIN_MFA_REQUIRED` cannot be
  off in production; `platform-admin reset-mfa` for lost devices. Web:
  profile enrollment with recovery codes, code step at login, admin console
  gate. Tests: RFC vectors, integration (enrollment, login, replay, recovery,
  refresh, disable, admin and oversight enforcement, CLI reset), Playwright.
- Deck-key rotation (ADR-008 amendment): game nodes read a keyring
  (`DECK_ENCRYPTION_KEYS`, first key active; `DECK_ENCRYPTION_KEY_B64` stays
  as a single key with id 1); migration 000011 records the sealing key per
  hand (`hands.seal_key_id`); `game-service reseal` re-encrypts finished
  hands with the active key; nodes refuse to start without the keys of hands
  in progress. Runbook docs/runbooks/deck-key-rotation.md.
- Credential endpoints (register, login, refresh) keep rate limiting in
  bounded per-process memory while Redis is unavailable instead of failing
  open; other limits still fail open (ADR-005). Integration test runs the API
  against an unreachable Redis.

### Added — Tournament operations

- Monitoring: game-service counters (tournaments started/cancelled/finished,
  eliminations, moves, failed operations by `op`); migration 000010 views
  `tournament_invariant_violations` and `tournament_health`, exported by the
  worker; alerts `TournamentInvariantViolation`, `TournamentTransferStuck`,
  `TournamentStartOverdue`, `TournamentOperationFailures`; Grafana row;
  docs/runbooks/tournaments.md; `make observability-check` (promtool) in CI.
- Chaos drill `tests/chaos/tournament_test.go`: SIGKILL the node owning most
  tables of a running multi-table sit-and-go; the survivor finishes it with
  exact results, payouts and clean health views.
- Load smoke tournament mode (`-tournaments N`, CI runs 4 x 12 players):
  bots register, follow balancing moves and play to the end; results,
  payouts and the ledger must reconcile and every bot must learn its result.

### Fixed

- Tournament players redirected while moving between tables (their
  destination broke before seating them) could lose track of their table and
  be timed out hand after hand. The breaking table now emits
  `PLAYER_LEFT MOVED` with `seat: 0` and the new `toTableId`, and the web
  table page re-reads `myTableId` from the tournament API while the viewer
  is unseated (covers moves that happened before it subscribed).

### Added — M10 Tournaments

- Sit-and-go (starts when full) and scheduled tournaments (cancelled and
  refunded when short of players), staff start/cancel (ADR-016,
  docs/tournaments.md).
- Ledger: per-tournament `TOURNAMENT_POOL` account; `TOURNAMENT_BUY_IN`,
  `TOURNAMENT_REFUND` and `TOURNAMENT_PAYOUT` flows validated by
  `ledger_post`; ledger summary reports chips in prize pools.
- `go/tournament`: blind schedule, payout table, finishing places with ties,
  prize splitting, seating and balancing/breaking with a whole-tournament
  simulation test; golden file shared with the TypeScript mirror.
- Game service: tournament scheduler (crypto seat draw, pool check) and a
  tournament mode of the table actor (level blinds, absent players folded,
  eliminations and the finish with payouts in the hand's transaction,
  balancing through transfers, tournament-chip conservation checks).
- Control API: tournament directory, registration with buy-ins, refunds,
  detail with levels/payouts/entrants; tournament tables hidden from cash
  lobbies and closed to buy-in/leave/close.
- Realtime: tournament section in snapshots and `HAND_STARTED`;
  `PLAYER_LEFT` reasons `MOVED`, `ELIMINATED`, `FINISHED`.
- Web: tournaments in the club lobby, creation form, tournament page,
  tournament table header with level countdown, automatic move to the new
  table, finishing banner.
- Tests: engine/rules unit and simulation tests, multi-table SNG with a node
  crash (game service), API integration, Playwright sit-and-go to the end.

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
