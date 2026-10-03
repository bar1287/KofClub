# Performance baseline

`make load-smoke` (`tests/load/cmd/loadsmoke`) drives bots through the real
control API and WebSocket gateway: register, join a club, receive chips, sit,
play (check/call with occasional bets, raises and folds, 20–300 ms think
time), leave, then verify the club ledger reconciles. It fails on
unexpected errors, p95 command round trip above the threshold (default
250 ms) or any ledger mismatch.

Command round trip = client `COMMAND` → gateway → game actor (validation,
fenced PostgreSQL transaction, broadcast) → `COMMAND_RESULT`.

## Baseline (single node, 4 vCPU sandbox, local PostgreSQL)

| Profile                        | Commands/s | Hands/s | p50    | p95     | p99     | Errors | Ledger |
| ------------------------------ | ---------- | ------- | ------ | ------- | ------- | ------ | ------ |
| 4 tables × 3 bots, 20 s        | 15.5       | 1.3     | 4.0 ms | 9.6 ms  | 13.1 ms | 0      | exact  |
| 25 tables × 6 bots (150), 30 s | 230        | 8.3     | 3.5 ms | 10.2 ms | 18.2 ms | 0      | exact  |

Spec §15 target: p95 action processing < 150 ms excluding network. The
bottleneck is one PostgreSQL transaction per action (by design: durability
before broadcast). Scale-out levers in order: more game nodes (tables are
independent), PostgreSQL resources, then partitioning append-only tables
(spec §18).
