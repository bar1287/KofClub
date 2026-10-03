# Project status

_Last updated: 2026-10-03_

This file is the hand-off record for humans and AI agents. Keep it in sync
with the repository at the end of every task.

## Current milestone

**M8 — Hardening** (next). M0–M7 are complete: the two-player vertical
slice is playable end to end in the browser, with hand history, club
administration, platform administration and operational dashboards.

## Milestones (spec §16)

| Milestone                | Status  | Notes                                                                                                                                           |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Foundation          | ✅ Done | Monorepo, Makefile, Compose, CI, migrations, contracts + codegen, health checks                                                                 |
| M1 — Identity + Clubs    | ✅ Done | Argon2id, EdDSA JWT, refresh rotation + reuse detection, sessions, clubs/invites/roles/bans, RBAC, audit, rate limits, idempotency              |
| M2 — Pure Hold'em engine | ✅ Done | `go/poker`: crypto shuffle, evaluator (exhaustive tests), NL betting state machine, side pots, odd chips, table/button; 12k-hand property tests |
| M3 — Ledger              | ✅ Done | Double-entry per-club ledger, `ledger_post()` single write path, idempotent postings, reversals, invariant view + worker gauge                  |
| M4 — Table service       | ✅ Done | Postgres leases + epoch fencing, table actor, per-action durability, atomic settlement, failover by replay, encrypted decks                     |
| M5 — Realtime            | ✅ Done | WebSocket gateway: HELLO/AUTH, ordered per-viewer streams, replay/resync, idempotent commands, revocation, backpressure                         |
| M6 — Web poker table     | ✅ Done | Next.js client: auth, clubs/lobby, chip grants, table UI, realtime client + reducer, Playwright two-browser E2E                                 |
| M7 — History + Admin     | ✅ Done | Hand history (ADR-008 visibility), club console, table closure with cash-out, ownership transfer, platform admin, Grafana/alerts, runbooks      |
| M8 — Hardening           | Pending |                                                                                                                                                 |
| M9 — Omaha               | Pending |                                                                                                                                                 |
| M10 — Tournaments        | Pending |                                                                                                                                                 |

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
visibility, table closure and administrative enforcement.

## How to verify the current state

```bash
make bootstrap && make deps && make migrate
make lint typecheck test integration
make e2e   # two browsers play a full hand against the real stack (Playwright)
make dev   # full stack in Docker; open http://localhost:3000
```

## Known issues

- None blocking.

## Technical debt

- NestJS pinned to 11 (v12 is ESM-only; needs ESM + Vitest migration) — ADR-011.
- Node Docker images copy the whole workspace into the build stage; image size not optimized.
- OpenTelemetry tracing not yet wired (request ids propagate; traces planned for M8).
- Rate limiter fails open when Redis is down (documented tradeoff; Argon2 cost still bounds brute force).
- Club _closure_ (terminal status CLOSED) has no endpoint yet; suspension and reinstatement do.
- Demo seed passwords are fixed for local convenience (seed refuses `APP_ENV=production`).
- Players who leave mid-hand are auto-checked/folded and removed after the hand; there is no "stand up after folding" yet.
- Busted players (stack 0) are unseated automatically after the hand (no re-buy flow yet).
- Tables cannot be reopened or edited after creation (close and create a new one).
- Engine simplifications (documented in docs/game-engine.md): no antes/straddles, no dead button or missed-blind tracking, no mucking at showdown.
- Web: a page reload that aborts an in-flight token refresh can lose the rotated cookie; the next refresh counts as reuse and the user must log in again (ADR-012).
- Web: other players only see "leaving after hand" after a resync (no event is emitted for a deferred leave).
- Admin console uses browser `prompt`/`confirm` dialogs for reasons and confirmations (functional, not polished).
- History queries run on the primary database (read replica / projection later, ADR-013).
- Web: no Content-Security-Policy header yet (M8 hardening); styling is plain CSS without a design system.

## Implemented API (control-api, `/v1`)

Auth: `POST /auth/register|login|refresh|logout`. Me: `GET /me`,
`GET /me/sessions`, `DELETE /me/sessions/{id}`. Clubs: `POST|GET /clubs`,
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
Platform admin: `GET /admin/overview`, `GET|PATCH /admin/users[/{id}]`,
`GET|PATCH /admin/clubs[/{id}]`, `GET /admin/audit-log`, `GET|PATCH /admin/risk-events[/{id}]`.
Canonical contract: `packages/contracts/openapi/control-api.yaml`
(integration tests validate responses against it).

## Next tasks

1. M8: chaos drill — kill a game-service process mid-hand in a multi-node
   setup and verify replay/adoption plus ledger consistency (automated).
2. M8: `tests/load` load-smoke (`make load-smoke`): N bot clients over the
   real WebSocket protocol; report p50/p95 action latency and error rates.
3. M8: backup/restore procedure + test (pg_dump/restore into a fresh DB,
   ledger invariants and hand history intact); runbook.
4. M8: security review (CSP and security headers for the web tier, dependency
   audit, secret scanning, rate-limit coverage), OpenTelemetry tracing.
