# ADR-003: Ledger model and chip conservation

Status: Accepted
Date: 2026-10-03

## Context

Virtual chips must never be created or destroyed accidentally, every
movement must be auditable, and retries must not duplicate movements
(spec §6.1). Both the TypeScript control plane (grants, adjustments) and the
Go game service (buy-in, cash-out, hand settlement) move chips.

## Decision

- Double-entry, append-only ledger: `ledger_accounts`, `ledger_transactions`
  (unique `external_ref` = idempotency key), `ledger_entries`
  (`amount_signed` int8, `balance_after`).
- Asset scope: chips are per club (`club_id` on every account). Account
  kinds: `CLUB_TREASURY` (issuer; may go negative = chips in circulation),
  `MEMBER_WALLET` (non-negative), `TABLE_STACK` (a player's chips at a table;
  non-negative).
- A single PostgreSQL function `ledger_post(...)` is the only write path. It
  validates zero-sum, non-negative balances, idempotency (returns the
  existing transaction for a repeated `external_ref` with identical
  content; rejects a conflicting one) and maintains the `balance` projection
  on `ledger_accounts` under row locks taken in a deterministic order.
  A deferred constraint trigger re-asserts per-transaction zero-sum at
  commit; UPDATE/DELETE on ledger tables is rejected by trigger.
- TypeScript and Go both call `ledger_post` (no duplicated business rules).
  The game service calls it inside the same transaction that completes a
  hand, so settlement and hand completion are atomic.
- Hand settlement posts the net result per player between `TABLE_STACK`
  accounts (`external_ref = hand:<hand_id>`).

## Consequences

- Business rules for chip movement live in SQL (tested by Go and TS
  integration tests); changes require a migration.
- Balance reads are O(1) via the projection; the projection can be audited
  against `SUM(ledger_entries)` at any time (`ledger_audit` view).
