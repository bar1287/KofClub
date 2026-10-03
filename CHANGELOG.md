# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — M0 Foundation

- Monorepo layout per spec §5: pnpm workspace + single Go module.
- `make` targets for bootstrap, dev (Docker Compose), deps, migrate, seed, fmt,
  lint, typecheck, test, integration, e2e, contracts, load-smoke.
- Docker Compose stack: PostgreSQL 16, Redis 7, one-shot migrations,
  control-api, realtime-gateway, game-service, worker, web.
- Dockerfiles for Go (`infra/docker/go.Dockerfile`) and Node
  (`infra/docker/node.Dockerfile`) deployables.
- SQL migration runner (`go/cmd/migrate`, golang-migrate, embedded migrations)
  and foundation migration (extensions, `set_updated_at`, `reject_mutation`).
- Contracts package: OpenAPI baseline (error envelope + error-code catalogue,
  health), realtime schema baseline, TS (openapi-typescript) and Go
  (oapi-codegen) generation with CI drift check.
- `/health/live`, `/health/ready` and `/metrics` on every deployable;
  structured JSON logging with request ids; graceful draining.
- Validated configuration (zod / `go/envconfig`), `.env.example`,
  `scripts/init-env.sh` secret generation.
- GitHub Actions CI: lint, typecheck, unit tests, contract drift,
  integration tests against PostgreSQL/Redis, migration round-trip, image builds.
- Documentation: README, AGENTS.md, PROJECT_STATUS.md, architecture,
  database, security, deployment docs and ADR-001…011.
