# ADR-005: PostgreSQL is the durable source of truth; Redis is never sole storage

Status: Accepted
Date: 2026-10-03

## Decision

- PostgreSQL 16 holds all durable business state: identity, clubs, ledger,
  table configuration, seats, hands, game event log, audit log, risk events.
- Redis 7 holds only ephemeral/derivable data: rate-limit counters, session
  revocation cache, presence. Losing Redis degrades rate limiting/presence
  but never loses chips, hands or accounts.
- Migrations are explicit SQL files (`db/migrations`, golang-migrate format)
  applied by `go/cmd/migrate`; no ORM auto-sync anywhere.

## Consequences

- Redis runs without persistence locally. In production, managed Redis
  with replication is used for availability, not durability.
- Services treat Redis failures as degradations (fail-open for presence,
  fail-closed only where security requires it — documented per feature).
