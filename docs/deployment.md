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

## Production configuration checklist

- `APP_ENV=production` (refuses weakened Argon2 cost and disabled rate limits).
- `TRUST_PROXY`: the number of proxy hops in front of control-api (e.g. `1`
  behind one ALB) or their addresses/CIDRs. Wrong values make every request
  appear to come from the load balancer, so per-IP rate limits would apply to
  all users together. `true`/`*` is refused.
- `CORS_ORIGINS` and the gateway's allowed origins: the web origin only.
- Secrets from the secret store: `AUTH_JWT_PRIVATE_KEY_B64` (control-api
  only), `AUTH_JWT_PUBLIC_KEY_B64` (control-api, gateway),
  `INTERNAL_SERVICE_TOKEN`, `IP_HASH_SECRET`, `DECK_ENCRYPTION_KEY_B64`
  (game nodes only).
- Web: served over HTTPS; the web tier sends a per-request nonce CSP and,
  with `APP_ENV=production|staging`, HSTS.
- Platform administrators: granted with the operator CLI
  (`node dist/cli/platform-admin.js grant <username>` in a one-off control-api
  task); never over HTTP.

## Backups

Production relies on the managed database's continuous backups
(point-in-time recovery) plus periodic logical exports
(`scripts/db-backup.sh`, custom format). Restores go into a fresh database
(`scripts/db-restore.sh` refuses non-empty targets). The restore drill
(`make backup-restore-check`, also in CI) proves a dump of played hands
restores to an identical, healthy database. Procedure:
[runbooks/backup-restore.md](runbooks/backup-restore.md).
