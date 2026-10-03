# Runbook: ledger invariant violation

Alert: `LedgerInvariantViolation` (`sum(ledger_invariant_violations) > 0`), page.
The worker evaluates the `ledger_invariant_violations` view every interval and
exports one gauge series per violation kind (docs/ledger.md).

This should never fire: every posting goes through `ledger_post()`, which
enforces zero-sum transactions, non-negative balances and flow rules inside
the database. A violation means data was changed outside that path (manual
SQL, a faulty migration) or a bug in the function itself.

## Immediate actions

1. **Freeze chip movements** for the affected club(s): suspend the club in the
   platform admin console (view-only; hands in progress finish, players can
   leave). For a platform-wide problem, scale the control-api to zero and
   drain game nodes (`SIGTERM`) — hands finish and leases are released.
2. Identify the violation:
   ```sql
   SELECT * FROM ledger_invariant_violations;
   ```
   Kinds (see `db/migrations/000005_ledger.up.sql`): `UNBALANCED_TRANSACTION`
   (a transaction's entries do not sum to zero), `PROJECTION_MISMATCH` (an
   account's cached balance differs from its entries), `CLUB_NOT_ZERO_SUM`
   (a club's accounts do not sum to zero) and `NEGATIVE_BALANCE`.
3. Find the originating transactions and actors:
   ```sql
   SELECT t.*, e.* FROM ledger_transactions t JOIN ledger_entries e ON e.tx_id = t.id
    WHERE t.id = '<tx id from the view>';
   SELECT * FROM audit_log WHERE created_at > now() - interval '1 day' ORDER BY created_at DESC;
   ```

## Repair

- Never `UPDATE`/`DELETE` ledger rows (triggers reject it, by design).
- Correct with compensating postings through the API
  (`POST /v1/clubs/{id}/ledger/transactions/{txId}/reversal`) or, for system
  accounts, a reviewed one-off script that calls `ledger_post()` with an
  `ADMIN_ADJUSTMENT` kind and an `external_ref` naming the incident.
- Confirm the view is empty, then reinstate suspended clubs and record the
  incident (timeline, root cause, compensating transaction ids).
