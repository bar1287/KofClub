# shellcheck shell=bash
# Runs a PostgreSQL client tool (pg_dump, pg_restore, psql) whose major
# version matches the server (16). Uses the local binary when it is new
# enough, otherwise the postgres:16-alpine image (host network, stdin/stdout).
pg_tool() {
  local tool="$1"
  shift
  local major=0
  if command -v "$tool" >/dev/null 2>&1; then
    major="$("$tool" --version | grep -oE '[0-9]+' | head -1)"
  fi
  if [[ "$major" -ge 16 ]]; then
    "$tool" "$@"
  else
    docker run --rm -i --network host postgres:16-alpine "$tool" "$@"
  fi
}
