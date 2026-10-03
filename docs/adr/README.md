# Architecture Decision Records

ADRs record significant technical decisions (spec §19). The spec places them
in `docs/adr/` (this directory); the project brief's `docs/decisions/` refers
to the same thing.

| ADR                                                     | Title                                                                  | Status   |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| [001](ADR-001-go-game-path-typescript-control-plane.md) | Go owns the realtime/game path; TypeScript owns the control plane      | Accepted |
| [002](ADR-002-table-ownership-fencing.md)               | Table actor ownership with leases and fencing tokens                   | Accepted |
| [003](ADR-003-ledger-chip-conservation.md)              | Ledger model and chip conservation                                     | Accepted |
| [004](ADR-004-websocket-ordering-reconnect.md)          | WebSocket event ordering and reconnect semantics                       | Accepted |
| [005](ADR-005-postgres-source-of-truth.md)              | PostgreSQL is the durable source of truth; Redis is never sole storage | Accepted |
| [006](ADR-006-virtual-chip-scope.md)                    | Virtual-chip-only scope and the real-money compliance boundary         | Accepted |
| [007](ADR-007-event-bus-threshold.md)                   | Event bus adoption threshold (NATS JetStream)                          | Accepted |
| [008](ADR-008-card-privacy-visibility.md)               | Card privacy, logging and hand-history visibility                      | Accepted |
| [009](ADR-009-wire-conventions.md)                      | Wire conventions: camelCase JSON, `/v1`, UUIDv7, integer chips         | Accepted |
| [010](ADR-010-web-first-client.md)                      | Web/PWA client first; Unity/native clients later on the same protocol  | Accepted |
| [011](ADR-011-toolchain-versions.md)                    | Toolchain pins: NestJS 11 (CommonJS), TypeScript 5.9, Go 1.26          | Accepted |
| [012](ADR-012-browser-session-realtime-client.md)       | Browser session handling and the reference realtime client             | Accepted |
| [013](ADR-013-history-admin-policies.md)                | Hand history, table closure and administrative enforcement             | Accepted |

## Template

```
# ADR-NNN: Title
Status: Proposed | Accepted | Superseded by ADR-MMM
Date: YYYY-MM-DD

## Context
## Decision
## Consequences (tradeoffs, migration impact)
```

Agent rule (spec): replacing a core technology requires an ADR explaining
compatibility impact, migration plan and why the change reduces risk.
