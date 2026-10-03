# ADR-014: Distributed tracing with OpenTelemetry

Status: Accepted
Date: 2026-10-03

## Context

Spec §14 requires traces along "HTTP/WS ingress → game command → DB/ledger
→ broadcast". Requests cross three processes (control-api, realtime gateway,
game service); player actions arrive over long-lived WebSockets; and the
game actor processes commands on its own goroutine.

## Decision

- OpenTelemetry everywhere, W3C `traceparent` propagation, OTLP/HTTP export.
  Export is opt-in (`OTEL_EXPORTER_OTLP_ENDPOINT`); propagation is always on.
- Go: the shared HTTP middleware opens server spans (named after the route
  pattern; probes and WebSocket upgrades are not spans) and adds `trace_id`
  to request logs; internal clients inject context. Each WebSocket command is
  its own trace (`ws.command`). The game actor receives the caller's context
  through its serialized inbox and records `table.command`, `table.persist`
  (the fenced transaction, including `ledger.post`) and `table.broadcast`.
- Node: the OpenTelemetry Node SDK with explicit instrumentations (HTTP,
  Express, NestJS, pg, ioredis, undici/fetch, pino) — not the
  auto-instrumentation meta-package, to keep the dependency surface small.
- Privacy by construction: attributes are ids, kinds and counts; SQL without
  parameter values, Redis commands without arguments, no headers or bodies.
  A test fails if a span attribute looks like a card.

## Consequences

- One extra transaction-scoped span per action; negligible next to the
  database round trip (load smoke unchanged).
- Timer-driven work (turn timeouts, hand starts) produces root
  `table.persist` spans without a client parent.
- The fan-out from the game service to gateways (internal event stream) is
  not linked to the originating trace; `table.broadcast` marks the hand-off.
- Metrics stay on Prometheus; logs, metrics and traces correlate through
  `request_id`/`trace_id`.
