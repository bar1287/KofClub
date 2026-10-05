#!/usr/bin/env bash
# Creates .env from .env.example on first run and fills in locally generated
# secrets (scripts/init-env.mjs). Safe to run repeatedly: existing non-empty
# values are preserved. Uses a local Node 18+ when there is one, otherwise
# the node image through Docker (so `make demo` needs only Docker).
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
  exec node scripts/init-env.mjs
fi
if command -v docker >/dev/null 2>&1; then
  exec docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/repo" -w /repo node:22-alpine node scripts/init-env.mjs
fi
echo "init-env: needs Node 18+ or Docker" >&2
exit 1
