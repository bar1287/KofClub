#!/usr/bin/env bash
# Restores a custom-format backup into an EMPTY database.
#
#   scripts/db-restore.sh backups/kofclub.dump postgres://.../kofclub_restored
#
# Refuses to restore into a database that already has a schema_migrations
# table (never overwrite a live database). Data is loaded before triggers
# and constraints are created, so append-only guards do not block the load
# and are active again afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/pg.sh
. scripts/lib/pg.sh
in="${1:?usage: db-restore.sh <file.dump> <empty-database-url>}"
url="${2:?usage: db-restore.sh <file.dump> <empty-database-url>}"
existing="$(pg_tool psql "$url" -tAc "SELECT to_regclass('public.schema_migrations') IS NOT NULL")"
if [[ "$existing" == "t" ]]; then
  echo "db-restore: target database is not empty; refusing to restore" >&2
  exit 1
fi
pg_tool pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$url" <"$in"
echo "restored $in"
