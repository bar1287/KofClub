# Runbook: service down / elevated 5xx

Alerts: `ServiceDown` (`up == 0`), `HttpErrorRate` (> 2% 5xx), page.

1. Check health endpoints of the affected job: `/health/live` (process up)
   and `/health/ready` (dependencies). `ready` lists failing checks
   (`postgres`, `redis`, `game-service`).
2. Recent deploy? Roll back first, investigate second.
3. Dependency failures:
   - PostgreSQL down → every service is unready; game nodes stop accepting
     commands (no state changes without durability). Restore the database,
     then verify `SELECT * FROM ledger_invariant_violations;` is empty.
   - Redis down → rate limiting fails open (`security_events_total{type="rate_limit_degraded"}`
     and a "rate limiter unavailable" warning); HTTP authentication still
     checks sessions in PostgreSQL on every request; the gateway keeps
     existing connections but cannot receive live revocations until Redis
     returns.
4. Gateway restarts are safe: clients reconnect with backoff and resume from
   their last sequence number. Game-service restarts drain first (hands
   finish, leases released, other nodes adopt tables).
