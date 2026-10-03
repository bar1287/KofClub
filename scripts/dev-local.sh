#!/usr/bin/env bash
# Runs every service natively (no containers except postgres/redis) with
# prefixed output. Ctrl+C stops everything.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

pids=()
run() {
  local name="$1"; shift
  ( "$@" 2>&1 | sed -u "s/^/[$name] /" ) &
  pids+=($!)
}
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

run game     go run ./apps/game-service/cmd/game-service
run gateway  go run ./apps/realtime-gateway/cmd/realtime-gateway
run api      pnpm --filter @kofclub/control-api dev
run worker   pnpm --filter @kofclub/worker dev
run web      pnpm --filter @kofclub/web dev
wait
