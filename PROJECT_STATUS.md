# Project status

_Last updated: 2026-10-03_

This file is the hand-off record for humans and AI agents. Keep it in sync
with the repository at the end of every task.

## Current milestone

**M1 — Identity + Clubs** (next). M0 is complete.

## Milestones (spec §16)

| Milestone                | Status  | Notes                                                                           |
| ------------------------ | ------- | ------------------------------------------------------------------------------- |
| M0 — Foundation          | ✅ Done | Monorepo, Makefile, Compose, CI, migrations, contracts + codegen, health checks |
| M1 — Identity + Clubs    | ⏳ Next |                                                                                 |
| M2 — Pure Hold'em engine | Pending |                                                                                 |
| M3 — Ledger              | Pending |                                                                                 |
| M4 — Table service       | Pending |                                                                                 |
| M5 — Realtime            | Pending |                                                                                 |
| M6 — Web poker table     | Pending |                                                                                 |
| M7 — History + Admin     | Pending |                                                                                 |
| M8 — Hardening           | Pending |                                                                                 |
| M9 — Omaha               | Pending |                                                                                 |
| M10 — Tournaments        | Pending |                                                                                 |

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

## Next tasks

1. M1: identity schema (users, sessions, refresh tokens), Argon2id, register/login/refresh/logout, `/v1/me`, sessions list/revoke.
2. M1: clubs (create/join by code or invite, members, roles/status), RBAC guards, audit log, rate limiting.
