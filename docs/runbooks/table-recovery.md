# Runbook: table recovery, voided hands, persistence failures

Alerts: `GamePersistFailures` (page), `HandsVoided`, `TableLeaseLosses` (ticket).

## How recovery works (ADR-002)

Each table is owned by one game node through a PostgreSQL lease with an
epoch (fencing token). Every action is persisted before it is broadcast.
When a node dies, its leases expire (`LEASE_TTL`, default 10 s) and another
node adopts the table (orphan scan every `ORPHAN_SCAN_INTERVAL`), decrypts the
deck and **replays** the persisted actions to resume the same hand. If replay
cannot reproduce the persisted events, the hand is **voided**: every player's
start-of-hand stack is restored and no chips move (`HAND_VOIDED` event,
`game_hands_voided_total{reason}`).

## GamePersistFailures

The actor refuses to change state when it cannot write (players see
`TABLE_UNAVAILABLE` and retry). Check, in order:

1. PostgreSQL health: connections (`max_connections`), disk, replication lag,
   locks: `SELECT * FROM pg_stat_activity WHERE wait_event_type = 'Lock';`
2. Fencing is counted separately (`game_lease_losses_total`, log
   `lease_lost_on_write`): another node owns the table — expected right
   after a failover; persistent values point at database latency or
   lease-TTL problems.
3. game-service logs: `durable_write_failed`.

## HandsVoided

Look up the hand: `SELECT id, table_id, void_reason FROM hands WHERE status = 'VOIDED' ORDER BY ended_at DESC LIMIT 20;`
`RECOVERY_REPLAY_FAILED` after a deploy suggests an engine change that is
not replay-compatible with in-flight hands — deploy engine changes only
after draining (a drain lets running hands finish first).

## TableLeaseLosses

Renewals failing (`lease_renew_failed` logs) usually mean database latency
above the renewal interval or a paused process (GC/VM). Investigate DB
latency first; increase `LEASE_TTL` only together with the renewal interval.

## Manual checks after an incident

```sql
-- No table should be both seated and unowned for longer than the TTL.
SELECT s.table_id, l.owner_node_id, l.expires_at FROM table_seats s
  LEFT JOIN table_leases l ON l.table_id = s.table_id
 WHERE l.expires_at IS NULL OR l.expires_at < now() GROUP BY 1, 2, 3;
-- Ledger consistency (must be empty).
SELECT * FROM ledger_invariant_violations;
```
