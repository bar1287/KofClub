# Observability

Every deployable exposes `/health/live`, `/health/ready` and Prometheus
`/metrics`, and logs structured JSON with request ids (spec §14). Logs never
contain hole cards, deck order, passwords, tokens or raw IPs (ADR-008).

## Local dashboards

```bash
make dev             # the stack
make observability   # Prometheus :9090, Jaeger :16686, Grafana :3001
```

Grafana starts with the provisioned **KofClub — platform overview**
dashboard (anonymous read-only access, local only). Configuration lives in
`infra/observability/` (scrape config, alert rules, Grafana provisioning).
Platform administrators also get a live summary in the web console
(`/admin`, backed by `GET /v1/admin/overview`).

## Metrics

| Service          | Metric                                                                                                                        | Meaning                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| all              | `http_requests_total{route,method,code}`, `http_request_duration_seconds`                                                     | HTTP traffic and latency                       |
| control-api      | `security_events_total{type}`                                                                                                 | logins, failures, refresh reuse, rate limiting |
| worker           | `ledger_invariant_violations{violation}`                                                                                      | must be 0                                      |
| worker           | `tournament_invariant_violations{violation}`                                                                                  | must be 0 (chips, prize pools, results)        |
| worker           | `tournaments_running`, `tournament_transfers_pending`, `tournament_transfer_oldest_age_seconds`, `tournaments_overdue_starts` | tournament operations                          |
| game-service     | `game_tournaments_{started,cancelled,finished}_total`, `game_tournament_{eliminations,moves}_total`                           | tournament lifecycle and activity              |
| game-service     | `game_tournament_failures_total{op}`                                                                                          | failed start/claim/rebalance/clear (retried)   |
| game-service     | `game_active_tables`, `game_hands_{started,completed,resumed}_total`                                                          | table activity                                 |
| game-service     | `game_hands_voided_total{reason}`                                                                                             | hands voided by recovery (no chips moved)      |
| game-service     | `game_command_latency_seconds`, `game_actions_total{kind,source}`                                                             | action processing (target p95 < 150 ms)        |
| game-service     | `game_command_rejections_total{code}`, `game_duplicate_commands_total`                                                        | rejected / duplicate commands                  |
| game-service     | `game_persist_failures_total{reason}`, `game_lease_losses_total`                                                              | durability and ownership problems              |
| game-service     | `game_turn_timeouts_total`                                                                                                    | automatic check/fold                           |
| realtime-gateway | `ws_connections`, `ws_table_subscriptions`, `gateway_table_feeds`                                                             | connection load                                |
| realtime-gateway | `ws_frames_{in,out}_total{type}`, `ws_command_latency_seconds`                                                                | traffic and command round trip                 |
| realtime-gateway | `ws_resyncs_total{reason}`, `ws_slow_consumer_disconnects_total`, `ws_auth_failures_total{reason}`                            | continuity and auth problems                   |

## Alerts

`infra/observability/alerts.yml` (validated with `promtool` by
`make observability-check`; a unit test checks that every alert names an
existing runbook); each alert links to a runbook in
[docs/runbooks](runbooks/README.md): LedgerInvariantViolation,
GamePersistFailures, HandsVoided, ServiceDown, HttpErrorRate,
HighActionLatency, WebSocketResyncStorm, TableLeaseLosses,
TournamentInvariantViolation, TournamentTransferStuck,
TournamentStartOverdue, TournamentOperationFailures.

## Traces

OpenTelemetry traces follow spec §14: HTTP/WS ingress → game command →
DB/ledger → broadcast. W3C trace context propagates through control-api
(Node SDK: HTTP, Express, NestJS, pg, ioredis, fetch), the realtime gateway
and the game service (Go). One player action is one trace:

```
realtime-gateway  ws.command                       (table.id, command.kind)
game-service        POST /internal/v1/tables/{tableId}/commands
game-service          table.command
game-service            table.persist              (fenced transaction; events.kinds)
game-service              ledger.post              (HAND_SETTLEMENT at hand end)
game-service            table.broadcast
```

Spans are exported only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (standard
`OTEL_TRACES_SAMPLER*` variables control sampling); request logs then carry
`trace_id`. Locally, `make observability` starts Jaeger (UI on
http://localhost:16686, also a Grafana data source); run services natively
with `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`, or set
`COMPOSE_OTEL_ENDPOINT=http://jaeger:4318` for the Compose stack.
`make trace-check` (CI) runs a load smoke against Jaeger and verifies the
span tree above.

Privacy: span attributes carry ids, action kinds, event kinds and counts —
never cards, tokens, headers, request bodies, SQL parameter values or Redis
arguments (tested in `apps/game-service/internal/table/tracing_integration_test.go`).
