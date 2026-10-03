#!/usr/bin/env bash
# Browser end-to-end tests against the real stack.
#
# Recreates a dedicated database (kofclub_e2e), builds every service, starts
# them natively on ports that do not clash with `make dev`, waits for
# readiness and runs Playwright (apps/web/e2e). PostgreSQL and Redis must be
# reachable (`make deps`). Extra arguments are passed to `playwright test`.
#
# Env overrides: E2E_WEB_PORT (3100), E2E_API_PORT (4400), E2E_RT_PORT (4500),
# E2E_GAME_PORT (4600), E2E_LOG_DIR, PLAYWRIGHT_CHROMIUM_EXECUTABLE.
set -euo pipefail
cd "$(dirname "$0")/.."

STACK_DB_NAME=kofclub_e2e
STACK_LOG_DIR="${E2E_LOG_DIR:-}"
# shellcheck source=lib/stack.sh
. scripts/lib/stack.sh
trap stack_cleanup EXIT INT TERM

stack_load_env
stack_configure "${E2E_WEB_PORT:-3100}" "${E2E_API_PORT:-4400}" "${E2E_RT_PORT:-4500}" "${E2E_GAME_PORT:-4600}"
export HAND_START_DELAY=1s HAND_INTERVAL=4s
stack_check_ports "$STACK_WEB_PORT" "$STACK_API_PORT" "$STACK_RT_PORT" "$STACK_GAME_PORT"
stack_reset_db
stack_build web
stack_start web

stack_step "Running Playwright"
cd "$stack_root/apps/web"
E2E_BASE_URL="http://localhost:${STACK_WEB_PORT}" pnpm exec playwright test "$@"
