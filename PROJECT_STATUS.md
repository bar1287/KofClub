# Project status

_Last updated: 2026-10-03_

This file is the hand-off record for humans and AI agents. Keep it in sync
with the repository at the end of every task.

## Current milestone

**M6 — Web poker table** (next). M0–M5 are complete.

## Milestones (spec §16)

| Milestone                | Status  | Notes                                                                                                                                           |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Foundation          | ✅ Done | Monorepo, Makefile, Compose, CI, migrations, contracts + codegen, health checks                                                                 |
| M1 — Identity + Clubs    | ✅ Done | Argon2id, EdDSA JWT, refresh rotation + reuse detection, sessions, clubs/invites/roles/bans, RBAC, audit, rate limits, idempotency              |
| M2 — Pure Hold'em engine | ✅ Done | `go/poker`: crypto shuffle, evaluator (exhaustive tests), NL betting state machine, side pots, odd chips, table/button; 12k-hand property tests |
| M3 — Ledger              | ⏳ Next |                                                                                                                                                 |
| M4 — Table service       | ⏳ Next |                                                                                                                                                 |
| M5 — Realtime            | ⏳ Next |                                                                                                                                                 |
| M6 — Web poker table     | ⏳ Next |                                                                                                                                                 |
| M7 — History + Admin     | Pending |                                                                                                                                                 |
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
010 web client first (Unity later), 011 toolchain pins (NestJS 11, TS 5.9, Go 1.26).

## How to verify the current state

```bash
make bootstrap && make deps && make migrate
make lint typecheck test integration
make dev   # full stack in Docker; all /health/ready endpoints return ok
```

## Known issues

- None blocking.

## Technical debt

- NestJS pinned to 11 (v12 is ESM-only; needs ESM + Vitest migration) — ADR-011.
- Node Docker images copy the whole workspace into the build stage; image size not optimized.
- OpenTelemetry tracing not yet wired (request ids propagate; traces planned for M8).
- Rate limiter fails open when Redis is down (documented tradeoff; Argon2 cost still bounds brute force).
- Ownership transfer and club suspension/closure endpoints not yet implemented (M7 admin).
- Demo seed passwords are fixed for local convenience (seed refuses `APP_ENV=production`).
- Players who leave mid-hand are auto-checked/folded and removed after the hand; there is no "stand up after folding" yet.
- Busted players (stack 0) are unseated automatically after the hand (no re-buy flow yet).
- Table closing (status CLOSED with cash-out of seated players) is not implemented yet (M7).
- Engine simplifications (documented in docs/game-engine.md): no antes/straddles, no dead button or missed-blind tracking, no mucking at showdown.

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
Tables: `POST|GET /clubs/{id}/tables`, `GET /tables/{id}`, `POST /tables/{id}/seat|leave`,
`GET /tables/{id}/state`.
Canonical contract: `packages/contracts/openapi/control-api.yaml`
(integration tests validate responses against it).

## Next tasks

1. M6: web client foundations: API client with token refresh (cookie transport), auth pages (register/login/logout), home (my clubs), club lobby (members, tables, invites, create table for staff, join by code), wallet display.
2. M6: realtime client (reconnect/backoff, HELLO/AUTH refresh, seq tracking, resubscribe with lastSeenSeq, resync) + pure table-state reducer with unit tests.
3. M6: poker table UI (seats, stacks, button, blinds, own hole cards, board, pot, current bet, legal-action buttons with amount input, turn indicator, timer, connection status), seat/leave flow.
4. M6: Playwright E2E: two browsers register, join club, receive chips, sit, play a complete hand.
