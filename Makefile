# KofClub developer commands (spec Appendix A).
# Run `make help` for the list of targets.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Load local configuration if present (never used in production).
-include .env
export

COMPOSE ?= docker compose
GO ?= go
PNPM ?= pnpm
GO_PKGS := ./...

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
.PHONY: env
env: ## Create .env with locally generated secrets (idempotent)
	@./scripts/init-env.sh

.PHONY: bootstrap
bootstrap: env ## Install JS/Go dependencies and build shared packages
	$(PNPM) install --frozen-lockfile
	$(GO) mod download
	$(PNPM) build:packages

# ---------------------------------------------------------------------------
# Local environment
# ---------------------------------------------------------------------------
.PHONY: dev
dev: env ## Build and start the full stack in Docker (migrations run automatically)
	$(COMPOSE) up -d --build --wait
	@echo "web: http://localhost:$${WEB_PORT:-3000}  api: http://localhost:$${CONTROL_API_PORT:-4000}  ws: ws://localhost:$${REALTIME_PORT:-4100}/ws"

.PHONY: deps
deps: env ## Start only PostgreSQL and Redis (for running services natively)
	$(COMPOSE) up -d --wait postgres redis

.PHONY: dev-local
dev-local: deps migrate ## Run all services natively with live reload (needs `make bootstrap`)
	./scripts/dev-local.sh

.PHONY: down
down: ## Stop the Docker stack (keeps the database volume)
	$(COMPOSE) down

.PHONY: logs
logs: ## Tail Docker stack logs
	$(COMPOSE) logs -f --tail=100

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
.PHONY: migrate
migrate: ## Apply pending migrations to DATABASE_URL
	$(GO) run ./go/cmd/migrate up

.PHONY: migrate-down
migrate-down: ## Roll back the most recent migration
	$(GO) run ./go/cmd/migrate down 1

.PHONY: migrate-status
migrate-status: ## Print the current schema version
	$(GO) run ./go/cmd/migrate version

.PHONY: seed
seed: ## Load demo data (users, club, table, chip grants)
	$(PNPM) --filter @kofclub/control-api seed

.PHONY: observability
observability: ## Start Prometheus (:9090), Jaeger (:16686) and Grafana (:3001); see docs/observability.md
	docker compose --profile observability up -d prometheus jaeger grafana

.PHONY: trace-check
trace-check: ## Verify end-to-end tracing: Jaeger + short load smoke + span-tree check (needs Docker, `make deps`)
	./scripts/trace-check.sh

.PHONY: platform-admin
platform-admin: ## Grant the platform-admin role: make platform-admin ADMIN_USER=<username> [ACTION=revoke]
	@test -n "$(ADMIN_USER)" || (echo "usage: make platform-admin ADMIN_USER=<username> [ACTION=grant|revoke]"; exit 2)
	$(PNPM) --filter @kofclub/control-api platform-admin $(or $(ACTION),grant) $(ADMIN_USER)

# ---------------------------------------------------------------------------
# Contracts
# ---------------------------------------------------------------------------
.PHONY: contracts
contracts: ## Regenerate TS + Go types from packages/contracts/openapi
	$(PNPM) --filter @kofclub/contracts generate
	$(GO) generate ./packages/contracts/go/...

.PHONY: contracts-check
contracts-check: contracts ## Fail if generated contracts are out of date
	$(PNPM) --filter @kofclub/contracts lint:openapi
	git diff --exit-code -- packages/contracts
	@test -z "$$(git status --porcelain -- packages/contracts)" || (echo "untracked generated files" && git status --porcelain -- packages/contracts && exit 1)

# ---------------------------------------------------------------------------
# Quality gates
# ---------------------------------------------------------------------------
.PHONY: fmt
fmt: ## Format all code
	$(PNPM) fmt
	gofmt -w $$(git ls-files '*.go')

.PHONY: fmt-check
fmt-check: ## Verify formatting
	$(PNPM) fmt:check
	@out="$$(gofmt -l $$(git ls-files '*.go'))"; if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi

.PHONY: lint
lint: fmt-check ## Lint TypeScript and Go
	$(PNPM) lint
	$(GO) vet $(GO_PKGS)
	$(GO) tool staticcheck $(GO_PKGS)

.PHONY: typecheck
typecheck: ## Typecheck TypeScript and compile Go
	$(PNPM) build:packages
	$(PNPM) typecheck
	$(GO) build $(GO_PKGS)

.PHONY: test
test: ## Unit tests (TypeScript + Go)
	$(PNPM) build:packages
	$(PNPM) test
	$(GO) test -race -count=1 $(GO_PKGS)

.PHONY: integration
integration: ## Integration tests against real PostgreSQL + Redis (run `make deps` first)
	$(PNPM) build:packages
	$(GO) test -race -count=1 -tags integration $(GO_PKGS)
	$(PNPM) test:integration

.PHONY: e2e
e2e: ## Browser end-to-end tests: fresh DB, native services, Playwright (needs `make deps`)
	./scripts/e2e.sh

.PHONY: load-smoke
load-smoke: ## Synthetic load test: bots play on a fresh stack, report latency, verify the ledger (needs `make deps`)
	./scripts/load-smoke.sh $(ARGS)

.PHONY: audit
audit: ## Known-vulnerability audit of npm and Go dependencies (needs network access to the advisory databases)
	$(PNPM) audit --prod --audit-level high
	$(GO) tool govulncheck ./...

.PHONY: backup-restore-check
backup-restore-check: ## Restore drill: dump the load-smoke DB, restore into a fresh DB, verify equivalence
	./scripts/backup-restore-check.sh

.PHONY: build
build: ## Build all deployables
	$(PNPM) build
	mkdir -p bin
	$(GO) build -o bin/ ./apps/game-service/cmd/game-service ./apps/realtime-gateway/cmd/realtime-gateway ./go/cmd/migrate

.PHONY: ci
ci: lint typecheck test contracts-check ## Everything CI runs except integration tests
