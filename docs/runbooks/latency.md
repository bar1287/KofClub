# Runbook: player action latency

Alert: `HighActionLatency` — p95 of `game_command_latency_seconds` above
150 ms for 5 minutes (spec §15 target: p95 < 150 ms excluding network).

Every accepted action is a PostgreSQL transaction (fenced write of the
event, command and runtime rows), so database latency dominates.

1. Compare `game_command_latency_seconds` with `ws_command_latency_seconds`
   (gateway round trip): if only the gateway number is high, look at
   gateway CPU / send queues (`ws_slow_consumer_disconnects_total`).
2. Database: slow queries (`pg_stat_statements`), lock waits, IOPS/CPU,
   connection pool saturation (`DATABASE_POOL_MAX` on control-api; pgx pool
   on game nodes).
3. Hot tables: very active tables serialize on their actor by design; check
   `game_active_tables` per node and rebalance by draining a node.
