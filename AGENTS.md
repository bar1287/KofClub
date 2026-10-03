# Instructions for AI coding agents

These rules come from the architecture specification (§17) and apply to every
change in this repository. Read `PROJECT_STATUS.md` first: it records the
current milestone, decisions, known issues and the exact next task.

## Rules

1. Work on exactly one milestone/task at a time (spec §16 roadmap).
2. Read `docs/adr/` and `packages/contracts/` before modifying interfaces.
3. The server is authoritative. Never trust client-derived game/economy state
   (cards, balances, seat/turn ownership, pots, outcomes).
4. Chips are int64. Never use floating point for chips or ledger values.
5. Every state-changing request has an idempotency/event id.
6. Do not write directly into another domain module's tables; call its API
   (for chips: the `ledger_post` SQL function).
7. Do not expose unrevealed cards in public DTOs, logs, traces, analytics or errors.
8. Every DB schema change requires a new migration in `db/migrations` with a
   working `.down.sql`.
9. Add/update tests with every behavior change.
10. Keep local development runnable through Docker Compose (`make dev`).
11. Never add real-money deposits, withdrawals, cash-out, crypto settlement or
    payment rails (ADR-006).
12. Before finishing a task run: `make fmt lint typecheck test integration`.
13. Proposing to replace a core technology requires an ADR (compatibility
    impact, migration plan, why it reduces risk).
14. Keep `PROJECT_STATUS.md` and `CHANGELOG.md` in sync with the repository.

## Conventions

- Wire: camelCase JSON, `/v1` HTTP prefix, UPPERCASE enums, UUIDs, RFC 3339 UTC
  timestamps, integer chips (ADR-009). Errors use the standard envelope with a
  machine-readable `code` from `packages/contracts/openapi/control-api.yaml`.
- Contracts: edit the OpenAPI YAML, then `make contracts`. Never edit generated files.
- Go: the pure engine `go/poker` must not import network/DB/UI packages
  (enforced by `go/poker/deps_test.go`).
- Business logic lives in services/domain packages, never in controllers or UI.

## Task completion report

Files changed · architecture decisions · commands executed and results ·
tests added · known limitations · exact next task.
