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
root="$(pwd)"

[[ -f .env ]] || ./scripts/init-env.sh >/dev/null
# Load .env without overriding variables already set (e.g. by CI).
while IFS= read -r line; do
  key="${line%%=*}"
  [[ "$line" == *=* && "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
  [[ -n "${!key+x}" ]] || export "$key=${line#*=}"
done <.env

web_port="${E2E_WEB_PORT:-3100}"
api_port="${E2E_API_PORT:-4400}"
rt_port="${E2E_RT_PORT:-4500}"
game_port="${E2E_GAME_PORT:-4600}"
log_dir="${E2E_LOG_DIR:-$(mktemp -d)}"
bin_dir="$(mktemp -d)"
mkdir -p "$log_dir"

# Dedicated database and Redis logical DB.
db_base="${DATABASE_URL%%\?*}"
db_query="${DATABASE_URL#"$db_base"}"
export DATABASE_URL="${db_base%/*}/kofclub_e2e${db_query}"
export REDIS_URL="${REDIS_URL%/*}/14"

export APP_ENV=test LOG_LEVEL="${E2E_LOG_LEVEL:-warn}" NEXT_TELEMETRY_DISABLED=1
export CORS_ORIGINS="http://localhost:${web_port}"
export GAME_SERVICE_URL="http://127.0.0.1:${game_port}"
export CONTROL_API_INTERNAL_URL="http://127.0.0.1:${api_port}"
export NEXT_PUBLIC_API_URL="http://localhost:${api_port}"
export NEXT_PUBLIC_REALTIME_URL="ws://localhost:${rt_port}/ws"
# Registration limits are covered by integration tests; repeated local runs
# would otherwise exhaust them.
export RATE_LIMIT_ENABLED=false
export HAND_START_DELAY=1s HAND_INTERVAL=4s DRAIN_DELAY=10ms DRAIN_DELAY_MS=0

pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$bin_dir"
}
trap cleanup EXIT INT TERM

step() { printf '\n==> %s\n' "$*"; }

for port in "$web_port" "$api_port" "$rt_port" "$game_port"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    echo "e2e: port ${port} is already in use" >&2
    exit 1
  fi
done

step "Recreating database kofclub_e2e"
go run ./go/cmd/devdb recreate
go run ./go/cmd/migrate up

step "Building services"
go build -o "$bin_dir/game-service" ./apps/game-service/cmd/game-service
go build -o "$bin_dir/realtime-gateway" ./apps/realtime-gateway/cmd/realtime-gateway
pnpm build:packages >/dev/null
pnpm --filter @kofclub/control-api build >/dev/null
pnpm --filter @kofclub/web build >"$log_dir/web-build.log" 2>&1 || {
  cat "$log_dir/web-build.log" >&2
  exit 1
}
standalone="apps/web/.next/standalone/apps/web"
rm -rf "$standalone/.next/static" "$standalone/public"
cp -r apps/web/.next/static "$standalone/.next/static"
cp -r apps/web/public "$standalone/public"

step "Starting services (logs: $log_dir)"
start() {
  local name="$1"
  shift
  "$@" >"$log_dir/$name.log" 2>&1 &
  pids+=($!)
}
GAME_SERVICE_PORT="$game_port" GAME_NODE_ID=e2e-node-1 \
  GAME_NODE_ADVERTISE_URL="http://127.0.0.1:${game_port}" \
  start game-service "$bin_dir/game-service"
REALTIME_PORT="$rt_port" start realtime-gateway "$bin_dir/realtime-gateway"
CONTROL_API_PORT="$api_port" start control-api node apps/control-api/dist/main.js
PORT="$web_port" HOSTNAME=127.0.0.1 start web node "$standalone/server.js"

wait_ready() {
  local name="$1" url="$2"
  for _ in $(seq 1 120); do
    if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "e2e: $name did not become ready ($url); last log lines:" >&2
  tail -n 40 "$log_dir/$name.log" >&2 || true
  exit 1
}
wait_ready game-service "http://127.0.0.1:${game_port}/health/ready"
wait_ready control-api "http://127.0.0.1:${api_port}/health/ready"
wait_ready realtime-gateway "http://127.0.0.1:${rt_port}/health/ready"
wait_ready web "http://127.0.0.1:${web_port}/health/ready"

step "Running Playwright"
cd "$root/apps/web"
E2E_BASE_URL="http://localhost:${web_port}" pnpm exec playwright test "$@"
