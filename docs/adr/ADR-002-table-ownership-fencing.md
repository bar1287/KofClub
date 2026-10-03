# ADR-002: Table actor ownership with leases and fencing tokens

Status: Accepted
Date: 2026-10-03

## Context

A table must have exactly one authoritative owner at a time (spec §4.1,
§13.1). A plain Redis lock is unsafe: a paused/partitioned node can keep
writing after its lock expired.

## Decision

- Leases live in PostgreSQL (`table_leases`: `table_id`, `owner_node_id`,
  `owner_url`, `epoch`, `expires_at`). PostgreSQL is already the durable
  store that the fencing check must protect, so the lease and the guarded
  writes share one consistency domain.
- Acquire: atomic `INSERT … ON CONFLICT DO UPDATE … WHERE expires_at < now()
OR owner_node_id = $me` that increments `epoch`.
- Renew: only the current `(owner_node_id, epoch)` may extend `expires_at`.
- Every durable game write runs in a transaction that first locks the lease
  row and verifies `(owner_node_id, epoch)`; a mismatch aborts the write and
  the actor shuts down (fencing). A stale node therefore cannot settle a hand
  or move chips after losing ownership.
- Failover: another node acquires a higher epoch after expiry and restores
  the table from durable state (seats + ledger; an unfinished hand is voided
  and its chips returned — see docs/game-engine.md "Recovery").
- Routing: the gateway/control-api look up `owner_url` for a table; a node
  that does not own a table answers `TABLE_UNAVAILABLE` so callers retry.

## Consequences

- One extra indexed row lock per durable game write (cheap at MVP scale).
- Lease renewal load on PostgreSQL grows with active tables; at the
  500–5k stage (spec §20) the registry may move to a dedicated store, but
  fencing validation must remain inside the durable write path.
