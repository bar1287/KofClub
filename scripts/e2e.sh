#!/usr/bin/env bash
# Browser end-to-end tests against the real stack.
#
# Recreates a dedicated database (kofclub_e2e), builds every service, starts
# them natively on ports that do not clash with `make dev`, waits for
# readiness and runs Playwright (apps/web/e2e). PostgreSQL and Redis must be
# reachable (`make deps`). Extra arguments are passed to `playwright test`.
#
# Env overrides: E2E_WEB_PORT (3100), E2E_API_PORT (4400), E2E_RT_PORT (4500),
# E2E_GAME_PORT (4600), E2E_TELEGRAM_API_PORT (4700), E2E_LOG_DIR,
# PLAYWRIGHT_CHROMIUM_EXECUTABLE.
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
# A made-up Telegram bot that is never contacted (the API URL goes nowhere):
# Playwright signs Mini App launch data with its token (e2e/telegram.spec.ts).
E2E_TELEGRAM_BOT_TOKEN="${E2E_TELEGRAM_BOT_TOKEN:-1234567:$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')}"
export E2E_TELEGRAM_BOT_TOKEN TELEGRAM_BOT_TOKEN="$E2E_TELEGRAM_BOT_TOKEN"
# e2e/store.spec.ts runs a stand-in for the Bot API on E2E_TELEGRAM_API_PORT
# and plays Telegram's part of Stars purchases through the webhook.
export E2E_TELEGRAM_API_PORT="${E2E_TELEGRAM_API_PORT:-4700}"
export TELEGRAM_BOT_USERNAME=kofclub_e2e_bot
export TELEGRAM_API_URL="http://127.0.0.1:${E2E_TELEGRAM_API_PORT}"
export TELEGRAM_WEBHOOK_SECRET="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
export E2E_TELEGRAM_WEBHOOK_SECRET="$TELEGRAM_WEBHOOK_SECRET"
export TELEGRAM_MINI_APP_URL="http://localhost:${STACK_WEB_PORT}"
export TELEGRAM_STARS_ENABLED=true TELEGRAM_SUPPORT_CONTACT=@kofclub_e2e_support
export E2E_API_URL="http://localhost:${STACK_API_PORT}"
# Operators (e2e/operator.spec.ts): bots register against the same stand-in.
export OPERATORS_ENABLED=true
export OPERATOR_SECRET_KEY_B64="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
export TELEGRAM_WEBHOOK_BASE_URL="http://localhost:${STACK_API_PORT}"
stack_check_ports "$STACK_WEB_PORT" "$STACK_API_PORT" "$STACK_RT_PORT" "$STACK_GAME_PORT" "$E2E_TELEGRAM_API_PORT"
stack_reset_db
stack_build web
stack_start web

stack_step "Running Playwright"
cd "$stack_root/apps/web"
E2E_BASE_URL="http://localhost:${STACK_WEB_PORT}" pnpm exec playwright test "$@"
