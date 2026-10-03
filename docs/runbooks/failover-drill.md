# Runbook: game-node failover drill

Automated in `tests/chaos/failover_test.go` (runs with `make integration`):

1. Two real `game-service` processes share a fresh database (`LEASE_TTL=3s`).
2. Two players sit through node A; a hand starts and three actions are made.
3. Node A is killed with `SIGKILL` (no drain, no lease release, no flush).
4. Node B's orphan scan adopts the table once the lease expires (~3 s),
   decrypts the deck and replays the persisted actions.
5. The drill asserts the resumed hand is identical (hand id, pot, street,
   board, player to act, both players' hole cards), finishes it on node B and
   checks: lease owned by node B with a higher epoch, a gap-free event log,
   exactly one `HAND_STARTED`/`HAND_COMPLETED`, zero ledger violations, exact
   chip conservation and seat/ledger agreement.

Manual version in a deployed environment (staging): pick a node with active
tables (`game_active_tables`), kill the task (not a graceful stop), and watch
`game_hands_resumed_total` increase on the surviving nodes while clients
show "Reconnecting…" then continue. Expected interruption ≈ `LEASE_TTL` plus
`ORPHAN_SCAN_INTERVAL`. If `game_hands_voided_total` increases instead, see
[table-recovery.md](table-recovery.md).
