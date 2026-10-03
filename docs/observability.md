# Observability

Every deployable exposes `/health/live`, `/health/ready` and Prometheus
`/metrics`, and logs structured JSON with request ids (spec §14). Logs never
contain hole cards, deck order, passwords, tokens or raw IPs (ADR-008).

## Local dashboards

```bash
make dev             # the stack
make observability   # Prometheus http://localhost:9090, Grafana http://localhost:3001
```

Grafana starts with the provisioned **KofClub — platform overview**
dashboard (anonymous read-only access, local only). Configuration lives in
`infra/observability/` (scrape config, alert rules, Grafana provisioning).
Platform administrators also get a live summary in the web console
(`/admin`, backed by `GET /v1/admin/overview`).

## Metrics

| Service          | Metric                                                                                             | Meaning                                        |
| ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| all              | `http_requests_total{route,method,code}`, `http_request_duration_seconds`                          | HTTP traffic and latency                       |
| control-api      | `security_events_total{type}`                                                                      | logins, failures, refresh reuse, rate limiting |
| worker           | `ledger_invariant_violations{violation}`                                                           | must be 0                                      |
| game-service     | `game_active_tables`, `game_hands_{started,completed,resumed}_total`                               | table activity                                 |
| game-service     | `game_hands_voided_total{reason}`                                                                  | hands voided by recovery (no chips moved)      |
| game-service     | `game_command_latency_seconds`, `game_actions_total{kind,source}`                                  | action processing (target p95 < 150 ms)        |
| game-service     | `game_command_rejections_total{code}`, `game_duplicate_commands_total`                             | rejected / duplicate commands                  |
| game-service     | `game_persist_failures_total{reason}`, `game_lease_losses_total`                                   | durability and ownership problems              |
| game-service     | `game_turn_timeouts_total`                                                                         | automatic check/fold                           |
| realtime-gateway | `ws_connections`, `ws_table_subscriptions`, `gateway_table_feeds`                                  | connection load                                |
| realtime-gateway | `ws_frames_{in,out}_total{type}`, `ws_command_latency_seconds`                                     | traffic and command round trip                 |
| realtime-gateway | `ws_resyncs_total{reason}`, `ws_slow_consumer_disconnects_total`, `ws_auth_failures_total{reason}` | continuity and auth problems                   |

## Alerts

`infra/observability/alerts.yml` (validated with `promtool`); each alert
links to a runbook in [docs/runbooks](runbooks/README.md):
LedgerInvariantViolation, GamePersistFailures, HandsVoided, ServiceDown,
HttpErrorRate, HighActionLatency, WebSocketResyncStorm, TableLeaseLosses.

Tracing (OpenTelemetry) is planned for M8; request ids already propagate
from the edge through control-api to the game service.
