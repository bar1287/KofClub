# ADR-001: Go owns the realtime/game path; TypeScript owns the control plane

Status: Accepted
Date: 2026-10-03

## Context

The platform has two very different workloads. The control plane (accounts,
clubs, roles, table configuration, ledger administration, history queries)
is request/response CRUD with rich validation and authorization. The game
plane (table actors, timers, action validation, fan-out to many WebSocket
connections) is latency-sensitive, long-lived and concurrency-heavy.

## Decision

- `apps/control-api` — NestJS/TypeScript: identity, clubs, RBAC, table
  configuration, ledger grants, hand-history and admin APIs.
- `apps/game-service` — Go: one serialized actor per table (goroutine +
  command channel), pure poker engine (`go/poker`), timers, persistence.
- `apps/realtime-gateway` — Go: WebSocket termination, authentication,
  subscriptions, sequence/ack handling, routing to the owning game node.
- `apps/web` — Next.js client; `apps/worker` — TypeScript async jobs.
- The poker domain lives only in Go (`go/poker`). TypeScript never
  re-implements poker rules; it calls the game service for table operations.

## Consequences

- Two languages to maintain; shared contracts are generated from OpenAPI
  (`packages/contracts`) for both TS and Go to avoid hand-copied schemas.
- Go's goroutine/channel model maps directly onto the table-actor model and
  gives predictable latency for thousands of connections per node.
- Control-plane features iterate quickly in a mainstream framework.
