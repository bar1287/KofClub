# KofClub

An original private-club **social poker platform** with **virtual chips only**:
users create or join clubs, sit at private tables and play realtime No-Limit
Texas Hold'em or Pot-Limit Omaha against each other, or enter multi-table
sit-and-go and scheduled tournaments. Chips have **no monetary value** — there are no
deposits, withdrawals, cash-outs or payment rails (see
[ADR-006](docs/adr/ADR-006-virtual-chip-scope.md)).

The technical source of truth is the architecture specification
(`AI_Poker_Club_Architecture_Spec.docx`); this repository implements it
milestone by milestone. Current status: see [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Architecture at a glance

```
 Browser (Next.js web/PWA)          later: Unity / native clients
      |  HTTPS (/v1)          | WebSocket (/ws)
      v                       v
 control-api (NestJS)    realtime-gateway (Go)
      |   \                   |
      |    \  internal HTTP   |  internal HTTP + stream
      |     +-------------> game-service (Go): table actors + go/poker engine
      v                       v
 PostgreSQL 16 (source of truth: identity, clubs, ledger, hands, events, audit)
 Redis 7 (ephemeral: rate limits, revocation cache, presence)
```

Details: [docs/architecture.md](docs/architecture.md).

| Path                    | What                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `apps/control-api`      | NestJS control plane: auth, clubs, RBAC, tables config, ledger admin, history |
| `apps/game-service`     | Go authoritative table actors (one owner per table, leases + fencing)         |
| `apps/realtime-gateway` | Go WebSocket gateway (auth, subscriptions, ordering, resync)                  |
| `apps/web`              | Next.js client (lobby, table UI, admin)                                       |
| `apps/worker`           | Background jobs                                                               |
| `go/poker`              | Pure poker engine (NLHE, PLO rule modules) — no network/DB dependencies       |
| `go/ledger-client`      | Go client for the ledger posting function                                     |
| `go/observability`      | Logging, metrics, health checks                                               |
| `packages/contracts`    | OpenAPI/realtime schemas + generated TS/Go types                              |
| `db/migrations`         | SQL migrations (golang-migrate format)                                        |
| `docs/`                 | Architecture, protocols, ADRs, runbooks                                       |

## Prerequisites

- Docker with Compose v2 (for `make dev` / `make deps`)
- For native development and tests: Node 22, pnpm 10, Go 1.26, GNU make, openssl

## Try it (only Docker needed)

**Windows (PowerShell):** install and start Docker Desktop, then

```powershell
git clone https://github.com/bar1287/KofClub.git
cd KofClub
.\demo.cmd
```

**macOS / Linux:** needs Docker (Compose 2.24+), `git` and `make`.

```bash
git clone https://github.com/bar1287/KofClub.git && cd KofClub
make demo       # builds and starts every service in Docker, then creates the demo accounts
```

The first run builds the images (5–10 minutes, up to 25 on a slower PC).
Without `make`:

```bash
./scripts/init-env.sh
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build --wait
docker compose exec -T -e SEED_FILE=/app/seeds/demo.json control-api node dist/seed/run-seed.js
```

If it fails:

- Windows: `demo.cmd` saves everything needed to find the cause in
  `demo-log.txt` (also `.\demo.cmd diagnose` at any time): versions, Docker
  Desktop's engine state and the end of its log, WSL, port use, the build
  output and the service logs (never `.env`).
- `port is already allocated`: ports 3000, 4000 and 4100 must be free (the
  demo publishes nothing else).
- `Cannot connect to the Docker daemon`: start Docker Desktop first.
- A build that is killed or hangs: give Docker at least 4 GB of memory
  (Docker Desktop → Settings → Resources).
- `make down` stops everything; `docker compose down -v` also deletes the
  demo data.

Open http://localhost:3000 and log in as `alice` / `alice-demo-password`
(owner of "Demo Club"), `bob` / `bob-demo-password` or `carol` /
`carol-demo-password`; everyone starts with 10,000 virtual chips. Use a second
browser or a private window to sit two players at the same table. To try the
platform admin console: `make platform-admin ADMIN_USER=carol` (needs
`make bootstrap`), then turn on two-factor authentication on carol's profile.

Screenshots of every screen (generated from the real stack with
`make screenshots`): [docs/screenshots](docs/screenshots/README.md).

## Quick start (everything in Docker)

```bash
git clone <repo> && cd KofClub
make dev        # creates .env with generated secrets, builds images, runs migrations, starts all services
make seed       # optional: demo users/club/table (needs `make bootstrap` once; `make demo` does both in Docker)
```

Then open http://localhost:3000. Services:

| Service                 | URL                                                        |
| ----------------------- | ---------------------------------------------------------- |
| web                     | http://localhost:3000                                      |
| control-api             | http://localhost:4000 (`/v1/...`, `/health/*`, `/metrics`) |
| realtime-gateway        | ws://localhost:4100/ws                                     |
| game-service (internal) | http://localhost:4200                                      |
| worker                  | http://localhost:4300/health/ready                         |

`make down` stops the stack (the database volume is kept).

## Native development

```bash
make bootstrap  # pnpm install, go mod download, build shared packages, create .env
make deps       # start only postgres + redis in Docker
make migrate    # apply migrations
make dev-local  # run all services natively with live reload
```

## Commands

| Command                                            | Purpose                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `make fmt` / `make fmt-check`                      | Format / verify formatting (Prettier + gofmt)                       |
| `make lint`                                        | ESLint, `go vet`, staticcheck                                       |
| `make typecheck`                                   | `tsc --noEmit` for all TS workspaces, `go build`                    |
| `make test`                                        | Unit tests (Jest + `go test -race`)                                 |
| `make integration`                                 | Integration tests against real PostgreSQL/Redis (`make deps` first) |
| `make e2e`                                         | Browser E2E (Playwright): fresh DB, services started natively       |
| `make migrate` / `migrate-down` / `migrate-status` | Schema migrations                                                   |
| `make seed`                                        | Demo data                                                           |
| `make demo`                                        | `make dev` plus demo accounts, Docker only                          |
| `make screenshots`                                 | Screenshot tour of the real stack into `docs/screenshots`           |
| `make platform-admin ADMIN_USER=<name>`            | Grant the platform-admin role (operator CLI, audited)               |
| `make observability`                               | Prometheus (:9090), Jaeger (:16686), Grafana (:3001)                |
| `make contracts` / `contracts-check`               | Regenerate / verify generated contract types                        |
| `make load-smoke`                                  | Bots play on a fresh stack; latency report + ledger check           |
| `make backup-restore-check`                        | Restore drill: dump, restore into a fresh DB, verify equivalence    |
| `make trace-check`                                 | Verify end-to-end OpenTelemetry traces (Jaeger)                     |
| `make audit`                                       | Known-vulnerability audit (npm + Go)                                |
| `make ci`                                          | Everything CI runs except integration tests                         |

## Configuration

All configuration is environment-based and validated at startup; services
refuse to boot with missing/invalid values. `.env.example` documents every
variable; `scripts/init-env.sh` creates `.env` with freshly generated local
secrets. `.env` files are for local use only — production secrets come from
a managed secret store ([docs/security.md](docs/security.md)).

## Documentation

- [docs/architecture.md](docs/architecture.md) — components, boundaries, data flow
- [docs/game-engine.md](docs/game-engine.md) — poker rules, state machine, pots
- [docs/tournaments.md](docs/tournaments.md) — tournaments: lifecycle, structure, payouts, balancing
- [docs/realtime-protocol.md](docs/realtime-protocol.md) — WebSocket protocol
- [docs/web-client.md](docs/web-client.md) — web client architecture, table UI, E2E tests
- [docs/observability.md](docs/observability.md) — metrics, dashboards, alerts
- [docs/runbooks](docs/runbooks/README.md) — what to do when an alert fires
- [docs/performance.md](docs/performance.md) — load baseline
- [docs/security-review.md](docs/security-review.md) — M8 security review
- [docs/ledger.md](docs/ledger.md) — chip accounting
- [docs/database.md](docs/database.md) — schema and migrations
- [docs/security.md](docs/security.md) — auth, RBAC, secrets, logging rules
- [docs/deployment.md](docs/deployment.md) — environments and rollout
- [docs/adr/](docs/adr/) — architecture decision records
- [AGENTS.md](AGENTS.md) — rules for AI coding agents working in this repo
