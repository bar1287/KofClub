# Runbook: backup and restore

## What is backed up

PostgreSQL is the only durable store (ADR-005): accounts, clubs, the
immutable chip ledger, tables, hands (with encrypted decks/hole cards) and
the event log. Redis holds only ephemeral data (rate-limit counters,
revocation cache) and is not backed up.

`DECK_ENCRYPTION_KEY_B64` must be backed up separately in the secret store:
without it, persisted decks and hole cards cannot be decrypted (in-progress
hands cannot be resumed and players cannot see their own cards in history).
Never store the key next to database dumps.

## Logical backup

```bash
scripts/db-backup.sh backups/kofclub-$(date -u +%Y%m%dT%H%M%SZ).dump   # DATABASE_URL
```

Custom-format dump (compressed). Runs against a live database (consistent
snapshot); prefer a read replica for large databases.

## Restore

1. Create an empty database (never restore over a live one; the script
   refuses targets that already have a schema).
2. `scripts/db-restore.sh <dump> <empty-database-url>` — single transaction;
   data loads before triggers/constraints are created, so append-only guards
   are active again afterwards.
3. Verify:
   ```sql
   SELECT * FROM schema_migrations;            -- expected version, dirty = false
   SELECT * FROM ledger_invariant_violations;  -- must be empty
   SELECT status, count(*) FROM hands GROUP BY status;
   ```
4. Hands that were `IN_PROGRESS` at backup time are resumed by replay (or
   voided with stacks restored) when a game node adopts their table.
5. Point the services at the restored database, start game nodes last.

## Drill

`make backup-restore-check` (CI job "ops-drills"): dumps the database left
by `make load-smoke`, restores it into `kofclub_restore_check`, and compares
a fingerprint of the two (row counts, ledger sums by account kind, event
sequences, migration version), requires zero ledger violations and checks
that immutability triggers still reject updates.
