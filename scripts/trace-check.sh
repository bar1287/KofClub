#!/usr/bin/env bash
# End-to-end tracing check: starts Jaeger (OTLP receiver), runs a short load
# smoke with every service exporting spans, and verifies that a player action
# is one trace from WebSocket ingress to persistence, ledger and broadcast.
set -euo pipefail
cd "$(dirname "$0")/.."
image="${JAEGER_IMAGE:-jaegertracing/all-in-one:1.73.0}"
docker rm -f kofclub-trace-check >/dev/null 2>&1 || true
docker run -d --name kofclub-trace-check -p 127.0.0.1:4318:4318 -p 127.0.0.1:16686:16686 \
  -e COLLECTOR_OTLP_ENABLED=true "$image" >/dev/null
trap 'docker rm -f kofclub-trace-check >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:16686/api/services >/dev/null 2>&1 && break
  sleep 0.5
done
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 ./scripts/load-smoke.sh -tables 2 -players 2 -duration 10s
go run ./tests/load/cmd/tracecheck -jaeger http://127.0.0.1:16686
