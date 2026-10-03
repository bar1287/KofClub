#!/usr/bin/env bash
# Logical backup of the database in DATABASE_URL (or the URL given as $2)
# in pg_dump's custom format (compressed, restorable selectively).
#
#   scripts/db-backup.sh backups/kofclub-$(date -u +%Y%m%dT%H%M%SZ).dump
#
# Production uses the managed service's continuous backups (PITR); this is
# for logical exports, migrations between environments and restore drills.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/pg.sh
. scripts/lib/pg.sh
out="${1:?usage: db-backup.sh <file.dump> [database-url]}"
url="${2:-${DATABASE_URL:?DATABASE_URL is required}}"
mkdir -p "$(dirname "$out")"
pg_tool pg_dump --format=custom --no-owner --no-privileges --dbname="$url" >"$out"
echo "backup written to $out ($(wc -c <"$out") bytes)"
