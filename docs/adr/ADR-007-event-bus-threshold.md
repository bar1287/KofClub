# ADR-007: Event bus adoption threshold (NATS JetStream)

Status: Accepted
Date: 2026-10-03

## Decision

No event bus in the MVP. Gateway↔game-service traffic uses direct internal
HTTP/WebSocket; durable facts are written to PostgreSQL in the same
transaction as the state change (game event log, ledger, audit log), which
is also the outbox for future consumers.

Introduce NATS JetStream (spec's recommendation) when any of these holds:

1. More than one consumer needs the same asynchronous event stream
   (e.g. risk analytics + notifications + history projection).
2. The scale stage reaches 500–5k concurrent players with multiple game
   nodes and gateway fan-out becomes a bottleneck.
3. Cross-service workflows need durable retries that a single DB
   transaction cannot express.

## Consequences

Fewer moving parts now. Adoption later reads from the existing durable
tables (`game_events`, `audit_log`) via an outbox relay, so no data model
change is needed. Kafka is not adopted unless analytics volume justifies it.
