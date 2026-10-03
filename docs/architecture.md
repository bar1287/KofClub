# Architecture

This document describes how the specification's target architecture (spec §2)
is realized in this repository. Decisions with tradeoffs are recorded as ADRs
in [`docs/adr`](adr/).

## 1. Planes and deployables

| Deployable              | Tech                   | Responsibility                                                                                                                                          |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/control-api`      | NestJS 11 / TypeScript | Identity, sessions, clubs, memberships, invites, RBAC, table configuration, ledger grants, hand history, admin, audit log                               |
| `apps/game-service`     | Go                     | Table ownership (leases + fencing), one serialized actor per table, poker engine, turn timers, seating/buy-in/cash-out, hand persistence and settlement |
| `apps/realtime-gateway` | Go                     | WebSocket lifecycle, token auth, table subscriptions, per-viewer fan-out, sequence/resync, command forwarding, heartbeats                               |
| `apps/web`              | Next.js / React        | Auth, home, club lobby, poker table, hand history, club & platform admin                                                                                |
| `apps/worker`           | TypeScript             | Background jobs (cleanup, exports, reports)                                                                                                             |
| `go/cmd/migrate`        | Go                     | Applies `db/migrations` (one-shot job)                                                                                                                  |

Control plane = control-api (+ worker). Game plane = game-service +
realtime-gateway. Both share PostgreSQL (each module writes only its own
tables) and Redis (ephemeral only).

## 2. Domain modules and data ownership (spec §3)

| Domain          | Module                                             | Owns tables                                                           |
| --------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| Identity        | control-api `identity`                             | `users`, `sessions`, `session_refresh_tokens`                         |
| Club            | control-api `clubs`                                | `clubs`, `club_members`, `club_invites`                               |
| Table directory | control-api `tables` (config)                      | `tables` (configuration columns)                                      |
| Game            | game-service                                       | `table_leases`, `table_seats`, `hands`, `hand_players`, `game_events` |
| Ledger          | SQL function `ledger_post` (called by both planes) | `ledger_accounts`, `ledger_transactions`, `ledger_entries`            |
| Audit           | control-api `audit`                                | `audit_log` (append-only)                                             |
| Risk            | shared `risk_events` writer API                    | `risk_events` (append-only)                                           |
| History         | control-api `history` (read-only)                  | reads `hands`, `hand_players`, `game_events`                          |

Rule (spec §3): a module owns its writes; other modules call its API. In the
monorepo this is enforced by package boundaries and repositories; chip
movements from any module go through `ledger_post`.

## 3. Request flows

### HTTP (control plane)

```
client -> control-api: request-id middleware -> auth guard (JWT) -> RBAC guard
       -> controller (validation only) -> service (business rules) -> repository (SQL)
       -> audit log (privileged actions) -> response / error envelope
```

### Seating (control plane -> game plane)

```
POST /v1/tables/{id}/seat
  control-api: auth + club membership + not banned
  -> game-service (internal HTTP, service token): SIT command to table actor
     actor: validate seat/buy-in -> ledger_post(MEMBER_WALLET -> TABLE_STACK) + table_seats
            in one transaction (fenced by lease epoch) -> emit PLAYER_SEATED (seq++)
```

### Gameplay (game plane)

```
client --COMMAND--> realtime-gateway --internal HTTP--> game-service TableActor
  actor (single goroutine): dedupe commandId -> check expectedSeq -> engine.Apply
     -> persist game_events (and settlement + hand completion atomically at hand end)
     -> seq++ -> publish event to subscribers
gateway <--internal event stream-- game-service
gateway: filter private payloads per viewer -> TABLE_EVENT to each client
```

## 4. Game plane design

- **Actor model** (spec §4.1): each active table is a goroutine owning the
  table state; commands arrive on a channel and are processed one at a time.
  No other code mutates table state.
- **Ownership** (ADR-002): PostgreSQL lease with epoch fencing; durable writes
  validate the epoch inside the same transaction.
- **Engine** (`go/poker`): pure, deterministic Hold'em state machine. Given the
  initial seats and a deck order, applying the same actions yields the same
  state — this enables replay tests and debugging.
- **State durability**:
  - ephemeral: in-memory actor state, timers, event retention window;
  - durable business state: `table_seats`, `hands`, `hand_players`, `game_events`;
  - immutable accounting: ledger entries (buy-in, settlement, cash-out).
- **Recovery**: on node failure the next owner restores seats from
  `table_seats` and stacks from ledger `TABLE_STACK` balances (which equal
  stacks at the last hand boundary). An in-progress hand is voided: no
  settlement was posted, so no chips move (see docs/game-engine.md).

## 5. Realtime

See [realtime-protocol.md](realtime-protocol.md) and ADR-004. Per-table
monotonic `seq`, bounded retention for missed-event replay, snapshots for
resync, command idempotency via `commandId`.

## 6. Cross-cutting

- **Contracts**: `packages/contracts` (OpenAPI 3.0) generates TS types
  (openapi-typescript) and Go types (oapi-codegen). CI fails on drift.
- **Errors**: one error-code catalogue for HTTP and realtime.
- **Observability**: JSON logs with `service`, `request_id`, table/hand ids;
  Prometheus `/metrics` on every service; `/health/live` + `/health/ready`
  on every deployable; graceful draining on SIGTERM.
- **Configuration**: environment variables validated at startup (zod in TS,
  `go/envconfig` in Go).
- **Security**: see [security.md](security.md).

## 7. Scaling path (spec §20)

| Stage            | Plan                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| 0–500 concurrent | 1–2 game nodes, single gateway pair, PostgreSQL + Redis, direct internal HTTP    |
| 500–5k           | multiple game nodes; lease registry routing; NATS JetStream for events (ADR-007) |
| 5k–50k           | partitioned ownership, autoscaling, read replicas for history                    |
| 50k+             | regional game clusters                                                           |

Tables scale horizontally; a table stays on one node during normal operation
and moves only between hands (drain) or on failover.
