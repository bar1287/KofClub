#!/usr/bin/env bash
# Product screenshots from the real stack.
#
# Recreates a dedicated database (kofclub_showcase), builds and starts every
# service natively, loads the demo data (db/seeds/demo.json), makes carol a
# platform administrator and runs the Playwright tour (apps/web/showcase),
# which saves PNGs to docs/screenshots (or SHOWCASE_DIR). PostgreSQL and
# Redis must be reachable (`make deps`).
set -euo pipefail
cd "$(dirname "$0")/.."

STACK_DB_NAME=kofclub_showcase
STACK_REDIS_DB=13
# shellcheck source=lib/stack.sh
. scripts/lib/stack.sh
trap stack_cleanup EXIT INT TERM

stack_load_env
stack_configure "${SHOWCASE_WEB_PORT:-3200}" "${SHOWCASE_API_PORT:-4700}" \
  "${SHOWCASE_RT_PORT:-4800}" "${SHOWCASE_GAME_PORT:-4900}"
export HAND_START_DELAY=1s HAND_INTERVAL=3s
stack_check_ports "$STACK_WEB_PORT" "$STACK_API_PORT" "$STACK_RT_PORT" "$STACK_GAME_PORT"
stack_reset_db
stack_build web
stack_start web

stack_step "Loading demo data"
pnpm --filter @kofclub/control-api seed
node apps/control-api/dist/cli/platform-admin.js grant carol

out="$(cd "$stack_root" && mkdir -p "${SHOWCASE_DIR:-docs/screenshots}" && cd "${SHOWCASE_DIR:-docs/screenshots}" && pwd)"
stack_step "Running the tour (screenshots: $out)"
cd "$stack_root/apps/web"
SHOWCASE_DIR="$out" E2E_BASE_URL="http://localhost:${STACK_WEB_PORT}" \
  pnpm exec playwright test -c playwright.showcase.config.ts "$@"
ls "$out"
