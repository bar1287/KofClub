# Project status

_Last updated: 2026-10-03_

This file is the hand-off record for humans and AI agents. Keep it in sync
with the repository at the end of every task.

## Current milestone

**M7 — History + Admin** (next). M0–M6 are complete: the two-player
vertical slice is playable end to end in the browser.

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
010 web client first (Unity later), 011 toolchain pins (NestJS 11, TS 5.9, Go 1.26),
012 browser session handling + reference realtime client.

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
- Ownership transfer and club suspension/closure endpoints not yet implemented (M7 admin).
- Demo seed passwords are fixed for local convenience (seed refuses `APP_ENV=production`).
- Players who leave mid-hand are auto-checked/folded and removed after the hand; there is no "stand up after folding" yet.
- Busted players (stack 0) are unseated automatically after the hand (no re-buy flow yet).
- Table closing (status CLOSED with cash-out of seated players) is not implemented yet (M7).
- Engine simplifications (documented in docs/game-engine.md): no antes/straddles, no dead button or missed-blind tracking, no mucking at showdown.
- Web: a page reload that aborts an in-flight token refresh can lose the rotated cookie; the next refresh counts as reuse and the user must log in again (ADR-012).
- Web: other players only see "leaving after hand" after a resync (no event is emitted for a deferred leave).
- Web: no hand-history view, invites UI, member management UI or club ledger UI yet (M7).
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
Tables: `POST|GET /clubs/{id}/tables`, `GET /tables/{id}`, `POST /tables/{id}/seat|leave`,
`GET /tables/{id}/state`.
Canonical contract: `packages/contracts/openapi/control-api.yaml`
(integration tests validate responses against it).

## Next tasks

1. M7: hand history API + UI with the ADR-008 visibility policy (own hole
   cards always, others' only if shown at showdown; staff audit view), per-hand
   ledger links and deck commitment/reveal for audit.
2. M7: club admin UI/API: invites management, member roles/bans, chip grants
   and deductions, club ledger (summary, balances, transactions, reversals),
   audit log; table close with cash-out of seated players; ownership transfer.
3. M7: platform admin (read-only oversight of clubs, risk events) and ops
   dashboards (metrics/alerts documentation).
4. M8: chaos test (kill game-service mid-hand via process), `tests/load`
   load-smoke, runbooks, backup/restore, CSP + security review, tracing.
