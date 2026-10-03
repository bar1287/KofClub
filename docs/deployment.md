# Deployment

## Environments (spec §13)

| Environment      | Topology                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| local            | Docker Compose: postgres, redis, migrate, control-api, realtime-gateway, game-service, worker, web (`make dev`)                      |
| CI               | GitHub Actions with ephemeral PostgreSQL/Redis service containers; unit, integration, contract and image-build checks                |
| development      | Shared cloud environment mirroring staging at small size                                                                             |
| staging          | Production-like managed DB/cache, 2 game instances, synthetic players                                                                |
| production (MVP) | Multi-AZ PostgreSQL (RDS), managed Redis (ElastiCache), ≥2 control-api and gateway instances, ≥2 game instances, object storage (S3) |

Kubernetes is not used for the MVP (spec §13). The intended AWS layout is
ECS Fargate services behind an ALB (HTTP + WebSocket), RDS PostgreSQL,
ElastiCache Redis, Secrets Manager and CloudWatch/Prometheus-compatible
metrics. `infra/terraform` will hold that definition.

## Images

- `infra/docker/go.Dockerfile` — targets `migrate`, `game-service`,
  `realtime-gateway` (static binaries on Alpine, non-root user).
- `infra/docker/node.Dockerfile` — targets `control-api`, `worker`, `web`
  (Next.js standalone output), non-root user.

## Rollout order

1. Run `migrate up` as a one-shot task (migrations are backward compatible
   with the previous application version).
2. Roll control-api and worker.
3. Roll realtime-gateway (clients reconnect and resync automatically).
4. Drain and roll game-service nodes one at a time: a draining node stops
   acquiring new tables, finishes running hands and releases leases between
   hands (spec §21 "Deployment during games").

## Health checks

Every deployable exposes `GET /health/live` (process up) and
`GET /health/ready` (dependencies reachable, not draining). On SIGTERM a
service reports `draining` for `DRAIN_DELAY` before closing listeners.
