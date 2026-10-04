# Runbook: tournaments

Alerts: `TournamentInvariantViolation`, `TournamentTransferStuck`,
`TournamentStartOverdue` (page), `TournamentOperationFailures` (ticket).
Design: [ADR-016](../adr/ADR-016-tournaments.md), [tournaments.md](../tournaments.md).

## Signals

| Metric (source)                                       | Meaning                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `tournament_invariant_violations{violation}` (worker) | rows of the `tournament_invariant_violations` view (must be 0)   |
| `tournaments_running` (worker)                        | tournaments in progress                                          |
| `tournament_transfers_pending` (worker)               | players moving between tables right now                          |
| `tournament_transfer_oldest_age_seconds` (worker)     | age of the oldest move (normally under a second or two)          |
| `tournaments_overdue_starts` (worker)                 | start condition met over a minute ago without a start            |
| `game_tournaments_{started,cancelled,finished}_total` | lifecycle per game node                                          |
| `game_tournament_{eliminations,moves}_total`          | activity per game node                                           |
| `game_tournament_failures_total{op}` (game service)   | failed `start`, `claim`, `rebalance`, `clear` (retried by polls) |

The worker refreshes its gauges every `JOB_INTERVAL_MS` (60 s by default);
the views can be queried directly at any time:

```sql
SELECT * FROM tournament_health;
SELECT * FROM tournament_invariant_violations;
```

## TournamentInvariantViolation

Every tournament write is verified in its own transaction, so a row here
means a defect or a manual database change. **Do not edit stacks or ledger
rows by hand.**

- `CHIPS_NOT_CONSERVED` (running tournament): seat stacks at the
  tournament's tables plus chips in `tournament_transfers` differ from
  `total_chips`. Compare `expected`/`actual`; find the last writes:
  `SELECT t.tournament_table_no, s.* FROM table_seats s JOIN tables t ON t.id = s.table_id WHERE t.tournament_id = '<id>';`
  The table actors refuse further writes that would keep the mismatch
  (`tournament_*_failed` logs), so play stops at the affected tables.
  Escalate to engineering with the game-service logs and the
  `game_events` of the tournament's tables.
- `POOL_MISMATCH`: the prize pool's ledger balance differs from the active
  buy-ins (registering), the frozen prize pool (running) or zero (finished,
  cancelled). Check `ledger_transactions WHERE reference_id = '<id>'` for the
  `TOURNAMENT_*` postings; the ledger invariant view must also be clean
  ([ledger runbook](ledger-invariant-violation.md)).
- `RESULTS_INCOMPLETE` (finished): places or prizes are missing. The finish
  is one transaction (places, payout, status), so this indicates a defect;
  escalate.

## TournamentTransferStuck

A player left a table (balancing/breaking) but the destination table has
not seated them. Their chips are safe in `tournament_transfers`.

1. Find the transfer and its destination:
   `SELECT x.*, l.owner_node_id, l.expires_at > now() AS live FROM tournament_transfers x LEFT JOIN table_leases l ON l.table_id = x.to_table_id;`
2. No live lease: the destination table is not running anywhere. The orphan
   scan adopts tables with pending arrivals within `ORPHAN_SCAN_INTERVAL`; if
   it does not, check that game nodes are up and not draining
   ([service-down](service-down.md)).
3. Live lease: look at that node's logs for `tournament_claim_failed`
   (`game_tournament_failures_total{op="claim"}`); database errors are retried
   on every poll (`TOURNAMENT_POLL_INTERVAL`, 1 s). Restarting the owning node
   is safe: the next owner claims the transfer.

## TournamentStartOverdue

A sit-and-go is full, a scheduled start time passed or staff requested a
start, but no game node started the tournament.

1. Are game nodes running? Every node runs the starter
   (`TOURNAMENT_SCAN_INTERVAL`, 1 s).
2. Logs: `tournament_start_failed` with the reason
   (`game_tournament_failures_total{op="start"}`). A message like
   `prize pool holds X but registrations paid Y` means the pool does not
   match the buy-ins: see `POOL_MISMATCH` above; do not start it by hand.
3. A start requested by staff with fewer than `minPlayers` (players
   unregistered afterwards) waits for registrations or the scheduled time;
   cancel it from the club if it should not run.

## TournamentOperationFailures

Repeated failures of moves/arrivals/clears are retried automatically.
Persistent values usually follow database trouble
([table-recovery](table-recovery.md)); after a deploy they can indicate a
code defect — check the `op` label and the matching `tournament_*_failed`
log lines.

## Drills

- Integration: `apps/game-service/internal/tournaments` plays a multi-table
  sit-and-go to the end with a node crash and checks the views.
- Chaos: `tests/chaos` kills the game node that runs a tournament
  (`SIGKILL`) and verifies another node finishes it.
- Load: `make load-smoke ARGS="-tournaments 10 -tournament-players 30"` plays
  many sit-and-gos with bots through the public API and gateway (CI runs a
  small one). Server-side timeouts during the run mean clients lost track
  of their table.

## Player waiting for a seat that never comes

A player moved by balancing follows `PLAYER_LEFT MOVED` (`toTableId`) to the
new table. If their destination broke before seating them, the breaking
table emits `PLAYER_LEFT MOVED` with `seat` 0 and the new destination; a
client that subscribed after either event re-reads `myTableId` from
`GET /v1/tournaments/{id}` (the web table page does this every 3 s while the
viewer is unseated). If a player still waits: check their entry
(`SELECT table_id, place FROM tournament_entries WHERE user_id = ...`) and
pending transfer; a transfer older than a minute raises
`TournamentTransferStuck`.
