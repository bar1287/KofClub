# Performance baseline

`make load-smoke` (`tests/load/cmd/loadsmoke`) drives bots through the real
control API and WebSocket gateway: register, join a club, receive chips, sit,
play (check/call with occasional bets, raises and folds, 20–300 ms think
time), leave, then verify the club ledger reconciles. It fails on
unexpected errors, p95 command round trip above the threshold (default
250 ms) or any ledger mismatch.

With `-tournaments N` it plays N sit-and-gos instead (`-tournament-players`,
`-tournament-seats`, `-tournament-level`): bots register (buy-ins into prize
pools), find their table, follow balancing moves (`PLAYER_LEFT MOVED`, or the
tournament API when they subscribed too late to see the event) and play
aggressively until every tournament finished. It additionally fails when a
tournament does not finish in time, results/payouts do not equal the pool,
or a bot never learns its elimination or win.

Command round trip = client `COMMAND` → gateway → game actor (validation,
fenced PostgreSQL transaction, broadcast) → `COMMAND_RESULT`.

## Baseline (single node, 4 vCPU sandbox, local PostgreSQL)

| Profile                        | Commands/s | Hands/s | p50    | p95     | p99     | Errors | Ledger |
| ------------------------------ | ---------- | ------- | ------ | ------- | ------- | ------ | ------ |
| 4 tables × 3 bots, 20 s        | 15.5       | 1.3     | 4.0 ms | 9.6 ms  | 13.1 ms | 0      | exact  |
| 25 tables × 6 bots (150), 30 s | 230        | 8.3     | 3.5 ms | 10.2 ms | 18.2 ms | 0      | exact  |

Tournaments (same sandbox):

| Profile                                   | Finished in | Hands | Moves | p50    | p95     | Timeouts | Ledger |
| ----------------------------------------- | ----------- | ----- | ----- | ------ | ------- | -------- | ------ |
| 10 SNGs × 18 players, 6-handed (180 bots) | 6–20 s      | 76    | 37    | 6.3 ms | 23.2 ms | 0        | exact  |
| 10 SNGs × 30 players, 3-handed (300 bots) | 16–28 s     | 337   | 110   | 8.2 ms | 29.9 ms | 0        | exact  |

"Timeouts" are server-side action timeouts (`PLAYER_ACTED` with `timeout`),
i.e. a bot that lost track of its table; before the in-transit redirect fix
some tournaments ran for minutes on timeouts.

Spec §15 target: p95 action processing < 150 ms excluding network. The
bottleneck is one PostgreSQL transaction per action (by design: durability
before broadcast). Scale-out levers in order: more game nodes (tables are
independent), PostgreSQL resources, then partitioning append-only tables
(spec §18).
