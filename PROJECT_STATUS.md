# Project status

_Last updated: 2026-10-07_

This file is the hand-off record for humans and AI agents. Keep it in sync
with the repository at the end of every task.

## Current milestone

**Roadmap complete (M0–M10).** No-Limit Hold'em and Pot-Limit Omaha cash
tables and multi-table sit-and-go/scheduled tournaments are playable end to
end in the browser (native and Docker Compose stacks), with hand history,
club and platform administration, dashboards, alerts, runbooks, distributed
tracing, failover/load/restore drills and a security review.

**Now: the W roadmap ([docs/roadmap.md](docs/roadmap.md))**, the plan from a
working platform to a world-class one (table essentials, game variety,
tournament depth, social, trust and safety, experience, production scale).
Current milestone: **W1.1 Pre-actions**.

## Milestones (spec §16)

| Milestone                | Status  | Notes                                                                                                                                                |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Foundation          | ✅ Done | Monorepo, Makefile, Compose, CI, migrations, contracts + codegen, health checks                                                                      |
| M1 — Identity + Clubs    | ✅ Done | Argon2id, EdDSA JWT, refresh rotation + reuse detection, sessions, clubs/invites/roles/bans, RBAC, audit, rate limits, idempotency                   |
| M2 — Pure Hold'em engine | ✅ Done | `go/poker`: crypto shuffle, evaluator (exhaustive tests), NL betting state machine, side pots, odd chips, table/button; 12k-hand property tests      |
| M3 — Ledger              | ✅ Done | Double-entry per-club ledger, `ledger_post()` single write path, idempotent postings, reversals, invariant view + worker gauge                       |
| M4 — Table service       | ✅ Done | Postgres leases + epoch fencing, table actor, per-action durability, atomic settlement, failover by replay, encrypted decks                          |
| M5 — Realtime            | ✅ Done | WebSocket gateway: HELLO/AUTH, ordered per-viewer streams, replay/resync, idempotent commands, revocation, backpressure                              |
| M6 — Web poker table     | ✅ Done | Next.js client: auth, clubs/lobby, chip grants, table UI, realtime client + reducer, Playwright two-browser E2E                                      |
| M7 — History + Admin     | ✅ Done | Hand history (ADR-008 visibility), club console, table closure with cash-out, ownership transfer, platform admin, Grafana/alerts, runbooks           |
| M8 — Hardening           | ✅ Done | Chaos (SIGKILL) failover drill, load smoke (230 cmd/s, p95 10 ms), restore drill, nonce CSP, TRUST_PROXY, audits + secret scan, OpenTelemetry traces |
| M9 — Omaha               | ✅ Done | Pot-Limit Omaha rule module (ADR-015): 4 hole cards, 2+3 evaluation, pot-limit caps; `gameType` on tables/hands/contracts; UI, history, PLO E2E      |
| M10 — Tournaments        | ✅ Done | ADR-016: SNG/scheduled, prize-pool ledger flows, level blinds, eliminations/ties/payouts, balancing/breaking via transfers, failover, UI, E2E        |

## Current architecture

See [docs/architecture.md](docs/architecture.md). Summary:

- pnpm workspace (`apps/control-api`, `apps/web`, `apps/worker`, `packages/*`).
- A single Go module at the repo root (`go/*`, `apps/game-service`,
  `apps/realtime-gateway`, `packages/contracts/go`, `db`).
- PostgreSQL 16 (source of truth), Redis 7 (ephemeral).
- Migrations: `db/migrations` (golang-migrate), applied by `go/cmd/migrate`.
- Contracts: `packages/contracts/openapi/*.yaml` → generated TS + Go types.

## Important decisions

ADRs in [docs/adr](docs/adr/README.md): 001 Go game plane / TS control plane,
002 Postgres lease + fencing, 003 ledger via `ledger_post` SQL function,
004 seq/resync semantics, 005 Postgres source of truth, 006 virtual chips
only, 007 no event bus yet, 008 card privacy, 009 camelCase wire + `/v1`,
010 web client first (Unity later), 011 toolchain pins (NestJS 11, TS 5.9, Go 1.26),
012 browser session handling + reference realtime client, 013 history
visibility, table closure and administrative enforcement, 014 OpenTelemetry
tracing, 015 game variants as rule modules in the engine, 016 tournaments on
the shared table infrastructure, 017 two-factor authentication (TOTP) required
for platform administration.

## How to verify the current state

```bash
make bootstrap && make deps && make migrate
make lint typecheck test integration
make e2e   # two browsers play a full hand against the real stack (Playwright)
make load-smoke && make backup-restore-check   # load baseline + restore drill
make load-smoke ARGS="-tournaments 10 -tournament-players 30"   # tournament load drill
make observability-check   # alert rules + dashboards (promtool)
make dev   # full stack in Docker; open http://localhost:3000 (make seed for demo data)
make demo  # Docker only: full stack plus demo accounts (alice/bob/carol, password <name>-demo-password)
make screenshots   # screenshot tour of the real stack into docs/screenshots
```

## Known issues

- None blocking.

## Technical debt

- NestJS pinned to 11 (v12 is ESM-only; needs ESM + Vitest migration) — ADR-011.
- Node Docker images copy the whole workspace into the build stage; image size not optimized.
- Game-service → gateway event fan-out is not linked to the originating trace (ADR-014).
- Rate limiter fails open when Redis is down except for register/login/refresh, which fall back to per-process memory counters (N replicas allow N times the budget).
- Read endpoints rely on edge rate limiting (docs/security-review.md); TOTP is the only second factor (no WebAuthn yet) and the TOTP secret key has no keyring (rotation means re-enrollment).
- Docker builds in restricted networks need a CA-trusting base image (sandbox-only; CI builds normally).
- Club _closure_ (terminal status CLOSED) has no endpoint yet; suspension and reinstatement do.
- Demo seed passwords are fixed for local convenience (seed refuses `APP_ENV=production`).
- Players who leave mid-hand are auto-checked/folded and removed after the hand; there is no "stand up after folding" yet.
- Busted players (stack 0) are unseated automatically after the hand (no re-buy flow yet).
- Tables cannot be reopened or edited after creation (close and create a new one).
- Engine simplifications (documented in docs/game-engine.md): no antes/straddles, no dead button or missed-blind tracking, no mucking at showdown, no hi/lo split games.
- A table's game type is fixed at creation (by design; hands record their own game).
- Tournaments (ADR-016): fixed blind progression and payout table, no antes, rebuys, add-ons, late registration, breaks or hand-for-hand; levels follow the wall clock; tables are polled (1 s) for arrivals/balancing; tournament pages poll the API (no realtime tournament channel), and an unseated player at a tournament table re-checks `myTableId` every 3 s.
- Web: a page reload that aborts an in-flight token refresh can lose the rotated cookie; the next refresh counts as reuse and the user must log in again (ADR-012).
- Web: other players only see "leaving after hand" after a resync (no event is emitted for a deferred leave).
- Admin console uses browser `prompt`/`confirm` dialogs for reasons and confirmations (functional, not polished).
- History queries run on the primary database (read replica / projection later, ADR-013).
- Web: styling is plain CSS without a design system.
- CI's Compose E2E job runs with production rate limits: the browser tests
  register exactly 10 accounts, the per-IP registration limit per hour. A new
  spec must reuse an existing spec's players (or the job needs a test-only
  limit).

## Implemented API (control-api, `/v1`)

Auth: `POST /auth/register|login|refresh|logout` (login takes `mfaCode`). Me: `GET /me`,
`GET /me/sessions`, `DELETE /me/sessions/{id}`, `GET /me/mfa`,
`POST /me/mfa/totp`, `POST /me/mfa/totp/confirm|disable`. Clubs: `POST|GET /clubs`,
`POST /clubs/join`, `GET /clubs/{id}`, `POST /clubs/{id}/join|leave`,
`POST /clubs/{id}/join-code/rotate`, `GET /clubs/{id}/members`,
`PATCH /clubs/{id}/members/{userId}`, `POST|GET /clubs/{id}/invites`,
`DELETE /clubs/{id}/invites/{inviteId}`, `GET /clubs/{id}/audit-log`.
Ledger: `GET /clubs/{id}/wallet`, `GET /clubs/{id}/wallet/entries`,
`POST /clubs/{id}/chips/grants|deductions`, `GET /clubs/{id}/ledger/summary|balances|transactions`,
`POST /clubs/{id}/ledger/transactions/{txId}/reversal`.
Tables: `POST|GET /clubs/{id}/tables`, `GET /tables/{id}`, `POST /tables/{id}/seat|leave|close`,
`GET /tables/{id}/state`. Club admin: `PATCH /clubs/{id}`, `POST /clubs/{id}/transfer-ownership`.
History: `GET /me/hands`, `GET /hands/{id}`, `GET /clubs/{id}/hands`.
Tournaments: `POST|GET /clubs/{id}/tournaments`, `GET /tournaments/{id}`,
`POST /tournaments/{id}/register|unregister|start|cancel`.
Platform admin: `GET /admin/overview`, `GET|PATCH /admin/users[/{id}]`,
`GET|PATCH /admin/clubs[/{id}]`, `GET /admin/audit-log`, `GET|PATCH /admin/risk-events[/{id}]`.
Canonical contract: `packages/contracts/openapi/control-api.yaml`
(integration tests validate responses against it).

## Next tasks

Follow [docs/roadmap.md](docs/roadmap.md) in its order of work, one milestone
at a time: W1.1 pre-actions, W1.2 time bank, W1.3 re-buy and top-up, W1.4
table chat and reactions, W1.5 showdown choices, W1.6 sounds, animations and
themes; then W2.1–W2.3 (antes, straddle and bomb pots, run it twice) and W7.1
(single origin). Earlier suggestions (tournament structures, late
registration, realtime tournament channel, passkeys, a keyring for
`MFA_ENCRYPTION_KEY_B64`, a native client) are part of that plan.

Done after the roadmap (see CHANGELOG): tournament operations (metrics,
health views, alerts, runbook, chaos and load drills); security follow-ups
from the review (login rate-limit fallback, deck-key rotation, admin MFA);
the Docker-only demo (`make demo`, `demo.cmd` on Windows with
`demo-log.txt` diagnostics) and screenshot tour; a gateway fix for events
lost between a table's first snapshot and its stream start.

`demo.cmd` cannot be exercised in CI (GitHub's Windows runners only run
Windows containers); it is checked by review and by users' `demo-log.txt`.
