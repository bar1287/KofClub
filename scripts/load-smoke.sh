#!/usr/bin/env bash
# Short synthetic load test (`make load-smoke`): recreates a dedicated
# database (kofclub_load), starts the backend natively on isolated ports and
# runs tests/load/cmd/loadsmoke (bots over the real HTTP and WebSocket APIs).
# PostgreSQL and Redis must be reachable (`make deps`). Arguments are passed
# to loadsmoke (e.g. -tables 10 -players 6 -duration 60s).
set -euo pipefail
cd "$(dirname "$0")/.."

STACK_DB_NAME=kofclub_load
STACK_REDIS_DB=13
STACK_LOG_DIR="${LOAD_LOG_DIR:-}"
# shellcheck source=lib/stack.sh
. scripts/lib/stack.sh
trap stack_cleanup EXIT INT TERM

stack_load_env
stack_configure 3200 "${LOAD_API_PORT:-4401}" "${LOAD_RT_PORT:-4501}" "${LOAD_GAME_PORT:-4601}"
export HAND_START_DELAY=500ms HAND_INTERVAL=1s ARGON2_MEMORY_KIB=19456
stack_check_ports "$STACK_API_PORT" "$STACK_RT_PORT" "$STACK_GAME_PORT"
stack_reset_db
stack_build
stack_start

stack_step "Running load smoke"
go run ./tests/load/cmd/loadsmoke \
  -api "http://127.0.0.1:${STACK_API_PORT}" -ws "ws://127.0.0.1:${STACK_RT_PORT}/ws" "$@"
