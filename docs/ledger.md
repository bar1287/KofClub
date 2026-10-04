# Ledger (virtual chips)

Virtual chips have **no monetary value** (ADR-006). They are accounted for
with a double-entry, append-only ledger (ADR-003) so that chips can never be
created, destroyed or double-spent by accident, and every movement can be
audited.

## Model

| Table                 | Purpose                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `ledger_accounts`     | One account per (kind, club, owner, table). `balance` is a projection maintained only by `ledger_post()` |
| `ledger_transactions` | One row per business operation; `external_ref` is the idempotency key (unique)                           |
| `ledger_entries`      | Signed movements (`amount_signed`, `balance_before`, `balance_after`, `reason`, `hand_id`)               |

Chips are scoped **per club** (each club is its own asset). Account kinds:

| Kind              | Owner        | May go negative | Meaning                                               |
| ----------------- | ------------ | --------------- | ----------------------------------------------------- |
| `CLUB_TREASURY`   | club         | yes             | Issuer. `-balance` = chips in circulation in the club |
| `MEMBER_WALLET`   | user         | no              | A member's chips in the club                          |
| `TABLE_STACK`     | user + table | no              | A member's chips sitting at one table (table escrow)  |
| `TOURNAMENT_POOL` | tournament   | no              | A tournament's prize pool (buy-ins until paid out)    |

## Transaction kinds and allowed flows

Enforced inside `ledger_post()` (defense against caller bugs):

| Kind                               | Flow                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CLUB_GRANT`, `PROMOTIONAL_CREDIT` | treasury → one wallet                                                                                           |
| `CLUB_DEDUCTION`                   | one wallet → treasury                                                                                           |
| `ADMIN_ADJUSTMENT`                 | treasury ↔ one wallet                                                                                           |
| `TABLE_BUY_IN`                     | a player's wallet → the same player's table stack                                                               |
| `TABLE_CASH_OUT`                   | a player's table stack → the same player's wallet (leaving, or the table closing: ref `close:<table>:<user>`)   |
| `HAND_SETTLEMENT`                  | between table stacks of **one** table (net result per player, `external_ref = hand:<hand_id>`)                  |
| `REVERSAL`                         | exact negation of an earlier transaction (at most one reversal each)                                            |
| `TOURNAMENT_BUY_IN`                | a wallet → a tournament pool (ref `tournament-buyin:<registration>`)                                            |
| `TOURNAMENT_REFUND`                | a tournament pool → a wallet (unregister/cancel; ref `tournament-refund:<registration>`, used by both services) |
| `TOURNAMENT_PAYOUT`                | one tournament pool → winners' wallets, emptying the pool (ref `tournament-payout:<tournament>`)                |

There are deliberately no deposit, withdrawal, payment or cash-out kinds.

## Invariants

1. All amounts are `bigint`; no floating point anywhere. Wire amounts are
   integers ≤ 10^15 (JSON-safe).
2. Every transaction has ≥ 2 entries, one per account, summing to zero —
   checked by `ledger_post()` and again by a deferred constraint trigger at
   commit.
3. Non-treasury balances never go negative (`CHECK` + `ledger_post()` check
   under row locks → `INSUFFICIENT_CHIPS`).
4. Every club's accounts sum to zero at all times.
5. History is immutable: UPDATE/DELETE on transactions and entries is
   rejected by triggers; account balances can only change inside
   `ledger_post()` (guarded by a transaction-local setting); accounts are
   created at zero and their identity is immutable.
6. Idempotency: the same `external_ref` with identical content returns the
   original transaction (`created=false`); different content raises
   `IDEMPOTENCY_CONFLICT`. Concurrent duplicates resolve to one transaction.
7. Deadlock-free: accounts are locked in id order.

`ledger_invariant_violations` (view) lists unbalanced transactions,
projection drift, clubs not summing to zero and negative balances. The worker
checks it every interval, logs `ledger_invariant_violation` at error level
and exports `ledger_invariant_violations{violation}` (must be 0) for alerting.

## Write path

`ledger_post(tx_id, external_ref, kind, club_id, actor_type, actor_user_id,
reference_type, reference_id, metadata, entries[, reverses_tx_id])` is the
only write path, used by:

- **control-api** (`LedgerRepository`) for grants, deductions and reversals;
- **game-service** (`go/ledger-client`) for buy-ins, cash-outs and hand
  settlement — called inside the same database transaction that updates
  seats/hands, so settlement and hand completion are atomic.

Errors are custom SQLSTATEs: `KL001` insufficient chips, `KL002` idempotency
conflict, `KL003` invariant violation, `KL004` account unusable, `KL005`
already reversed. Both clients map them to API error codes.

## Chip lifecycle at a table (M4)

```
grant:      treasury  -1000  wallet(A)  +1000
buy-in:     wallet(A) -500   stack(A,T) +500        (sit down)
hand:       stack(A,T) +150  stack(B,T) -150        (net result per player)
cash-out:   stack(A,T) -650  wallet(A)  +650        (leave the table)
```

Between hands a player's `TABLE_STACK` balance equals their stack at the
table. During a hand, chips in the pot are still in the players' table-stack
accounts; only the final net result is posted. A hand that cannot complete
(crash, lost ownership) therefore never touches the ledger and stacks
return to their start-of-hand values.

Tournament stacks are tournament chips, not ledger chips: tournament hands
never post `HAND_SETTLEMENT`; the game service instead verifies that the
tournament's seat stacks plus chips in transit equal the chips put in play
(docs/tournaments.md).

## HTTP API (control-api)

| Method | Path                                                     | Who                                 |
| ------ | -------------------------------------------------------- | ----------------------------------- |
| GET    | `/v1/clubs/{clubId}/wallet`                              | member                              |
| GET    | `/v1/clubs/{clubId}/wallet/entries`                      | member (own entries)                |
| POST   | `/v1/clubs/{clubId}/chips/grants`                        | ADMIN+ (`Idempotency-Key` required) |
| POST   | `/v1/clubs/{clubId}/chips/deductions`                    | ADMIN+ (`Idempotency-Key` required) |
| GET    | `/v1/clubs/{clubId}/ledger/summary`                      | ADMIN+, platform admin              |
| GET    | `/v1/clubs/{clubId}/ledger/balances`                     | ADMIN+, platform admin              |
| GET    | `/v1/clubs/{clubId}/ledger/transactions`                 | ADMIN+, platform admin              |
| POST   | `/v1/clubs/{clubId}/ledger/transactions/{txId}/reversal` | ADMIN+ (administrative kinds only)  |

Grants/deductions/reversals are audited (`CHIPS_GRANTED`, `CHIPS_DEDUCTED`,
`LEDGER_REVERSED`) in the same database transaction. Staff granting chips to
themselves raises a `SELF_CHIP_GRANT` risk event for review.

## Tests

- `go/ledger-client/ledger_integration_test.go`: lifecycle, zero-sum,
  amount validation, idempotency, overdraft, per-kind flow rules, cross-club
  isolation, immutability, 40-way concurrent overdraft race, 20-way
  duplicate-posting race, reversals (incl. forged reversals), and a
  randomized conservation property.
- `apps/control-api/test/integration/ledger.int-spec.ts`: API behaviour,
  RBAC/tenancy, idempotency, validation, reversals, reporting consistency and
  `ledger_invariant_violations` empty.
