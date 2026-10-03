# shellcheck shell=bash
# Shared helpers for scripts that run the whole stack natively against a
# dedicated database (scripts/e2e.sh, scripts/load-smoke.sh). Source it from
# the repository root after setting STACK_DB_NAME.

stack_root="$(pwd)"
stack_pids=()
stack_bin_dir="$(mktemp -d)"

# Loads .env without overriding variables that are already set (e.g. by CI).
stack_load_env() {
  [[ -f .env ]] || ./scripts/init-env.sh >/dev/null
  local line key
  while IFS= read -r line; do
    key="${line%%=*}"
    [[ "$line" == *=* && "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    [[ -n "${!key+x}" ]] || export "$key=${line#*=}"
  done <.env
}

# stack_configure <web_port> <api_port> <rt_port> <game_port>
stack_configure() {
  STACK_WEB_PORT="$1" STACK_API_PORT="$2" STACK_RT_PORT="$3" STACK_GAME_PORT="$4"
  STACK_LOG_DIR="${STACK_LOG_DIR:-$(mktemp -d)}"
  mkdir -p "$STACK_LOG_DIR"
  local db_base="${DATABASE_URL%%\?*}"
  local db_query="${DATABASE_URL#"$db_base"}"
  export DATABASE_URL="${db_base%/*}/${STACK_DB_NAME}${db_query}"
  export REDIS_URL="${REDIS_URL%/*}/${STACK_REDIS_DB:-14}"
  export APP_ENV=test LOG_LEVEL="${STACK_LOG_LEVEL:-warn}" NEXT_TELEMETRY_DISABLED=1
  export CORS_ORIGINS="http://localhost:${STACK_WEB_PORT}"
  export GAME_SERVICE_URL="http://127.0.0.1:${STACK_GAME_PORT}"
  export CONTROL_API_INTERNAL_URL="http://127.0.0.1:${STACK_API_PORT}"
  export NEXT_PUBLIC_API_URL="http://localhost:${STACK_API_PORT}"
  export NEXT_PUBLIC_REALTIME_URL="ws://localhost:${STACK_RT_PORT}/ws"
  # Registration limits are covered by integration tests; repeated runs and
  # many test accounts would otherwise exhaust them.
  export RATE_LIMIT_ENABLED=false
  export DRAIN_DELAY=10ms DRAIN_DELAY_MS=0
}

stack_cleanup() {
  local pid
  for pid in "${stack_pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$stack_bin_dir"
}

stack_step() { printf '\n==> %s\n' "$*"; }

stack_check_ports() {
  local port
  for port in "$@"; do
    if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
      echo "port ${port} is already in use" >&2
      return 1
    fi
  done
}

stack_reset_db() {
  stack_step "Recreating database ${STACK_DB_NAME}"
  go run ./go/cmd/devdb recreate
  go run ./go/cmd/migrate up
}

# stack_build [web]
stack_build() {
  stack_step "Building services"
  go build -o "$stack_bin_dir/game-service" ./apps/game-service/cmd/game-service
  go build -o "$stack_bin_dir/realtime-gateway" ./apps/realtime-gateway/cmd/realtime-gateway
  pnpm build:packages >/dev/null
  pnpm --filter @kofclub/control-api build >/dev/null
  if [[ "${1:-}" == "web" ]]; then
    pnpm --filter @kofclub/web build >"$STACK_LOG_DIR/web-build.log" 2>&1 || {
      cat "$STACK_LOG_DIR/web-build.log" >&2
      return 1
    }
    local standalone="apps/web/.next/standalone/apps/web"
    rm -rf "$standalone/.next/static" "$standalone/public"
    cp -r apps/web/.next/static "$standalone/.next/static"
    cp -r apps/web/public "$standalone/public"
  fi
}

stack_spawn() {
  local name="$1"
  shift
  "$@" >"$STACK_LOG_DIR/$name.log" 2>&1 &
  stack_pids+=($!)
}

stack_wait_ready() {
  local name="$1" url="$2" i
  for i in $(seq 1 120); do
    if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "$name did not become ready ($url); last log lines:" >&2
  tail -n 40 "$STACK_LOG_DIR/$name.log" >&2 || true
  return 1
}

# stack_start [web]
stack_start() {
  stack_step "Starting services (logs: $STACK_LOG_DIR)"
  GAME_SERVICE_PORT="$STACK_GAME_PORT" GAME_NODE_ID="${STACK_DB_NAME}-node-1" \
    GAME_NODE_ADVERTISE_URL="http://127.0.0.1:${STACK_GAME_PORT}" \
    stack_spawn game-service "$stack_bin_dir/game-service"
  REALTIME_PORT="$STACK_RT_PORT" stack_spawn realtime-gateway "$stack_bin_dir/realtime-gateway"
  CONTROL_API_PORT="$STACK_API_PORT" stack_spawn control-api node apps/control-api/dist/main.js
  if [[ "${1:-}" == "web" ]]; then
    PORT="$STACK_WEB_PORT" HOSTNAME=127.0.0.1 \
      stack_spawn web node "apps/web/.next/standalone/apps/web/server.js"
  fi
  stack_wait_ready game-service "http://127.0.0.1:${STACK_GAME_PORT}/health/ready"
  stack_wait_ready control-api "http://127.0.0.1:${STACK_API_PORT}/health/ready"
  stack_wait_ready realtime-gateway "http://127.0.0.1:${STACK_RT_PORT}/health/ready"
  if [[ "${1:-}" == "web" ]]; then
    stack_wait_ready web "http://127.0.0.1:${STACK_WEB_PORT}/health/ready"
  fi
}
