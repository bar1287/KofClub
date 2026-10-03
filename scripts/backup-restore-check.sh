#!/usr/bin/env bash
# Restore drill: dumps a database populated by real play (by default the
# load-smoke database), restores it into a fresh database and verifies the
# copy is equivalent and healthy (counts, balances, event sequences, ledger
# invariants, migration version, immutability guards).
#
#   scripts/backup-restore-check.sh [source-db-name]   (default kofclub_load)
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/pg.sh
. scripts/lib/pg.sh

[[ -f .env ]] || ./scripts/init-env.sh >/dev/null
if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
fi
base="${DATABASE_URL%%\?*}"
query="${DATABASE_URL#"$base"}"
source_url="${base%/*}/${1:-kofclub_load}${query}"
target_db="kofclub_restore_check"
target_url="${base%/*}/${target_db}${query}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> Backing up ${1:-kofclub_load}"
scripts/db-backup.sh "$work/backup.dump" "$source_url"

echo "==> Restoring into ${target_db}"
APP_ENV=test DATABASE_URL="$target_url" go run ./go/cmd/devdb recreate
scripts/db-restore.sh "$work/backup.dump" "$target_url"

fingerprint() {
  pg_tool psql "$1" -tA -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'migration ' || version || ' dirty=' || dirty FROM schema_migrations;
SELECT 'users ' || count(*) FROM users;
SELECT 'sessions ' || count(*) FROM sessions;
SELECT 'clubs ' || count(*) FROM clubs;
SELECT 'members ' || count(*) FROM club_members;
SELECT 'tables ' || count(*) || ' open=' || count(*) FILTER (WHERE status = 'OPEN') FROM tables;
SELECT 'seats ' || count(*) || ' stacks=' || coalesce(sum(stack_cached), 0) FROM table_seats;
SELECT 'hands ' || status || ' ' || count(*) FROM hands GROUP BY status ORDER BY status;
SELECT 'hand_players ' || count(*) || ' net=' || coalesce(sum(net), 0) FROM hand_players;
SELECT 'events ' || count(*) || ' tables=' || count(DISTINCT table_id) || ' maxseq=' || coalesce(max(seq), 0) FROM game_events;
SELECT 'commands ' || count(*) FROM table_commands;
SELECT 'ledger_tx ' || kind || ' ' || count(*) FROM ledger_transactions GROUP BY kind ORDER BY kind;
SELECT 'ledger_entries ' || count(*) || ' sum=' || coalesce(sum(amount_signed), 0) FROM ledger_entries;
SELECT 'balances ' || kind || ' ' || sum(balance) FROM ledger_accounts GROUP BY kind ORDER BY kind;
SELECT 'audit ' || count(*) FROM audit_log;
SELECT 'risk ' || count(*) FROM risk_events;
SQL
}

echo "==> Comparing"
fingerprint "$source_url" >"$work/source.txt"
fingerprint "$target_url" >"$work/target.txt"
if ! diff -u "$work/source.txt" "$work/target.txt"; then
  echo "backup-restore-check: restored database differs from the source" >&2
  exit 1
fi
cat "$work/target.txt"

violations="$(pg_tool psql "$target_url" -tAc 'SELECT count(*) FROM ledger_invariant_violations')"
[[ "$violations" == "0" ]] || { echo "ledger invariant violations after restore: $violations" >&2; exit 1; }

# Append-only guards must be active again after the restore: rewriting an
# existing ledger entry has to be rejected by its trigger.
if pg_tool psql "$target_url" -v ON_ERROR_STOP=1 -tAc \
  'UPDATE ledger_entries SET amount_signed = amount_signed WHERE id = (SELECT id FROM ledger_entries LIMIT 1)' \
  >/dev/null 2>&1; then
  echo "ledger_entries accepted an UPDATE after restore: immutability trigger missing" >&2
  exit 1
fi

APP_ENV=test DATABASE_URL="$target_url" go run ./go/cmd/devdb recreate >/dev/null
echo "backup-restore-check: OK (restored copy is identical and healthy)"
