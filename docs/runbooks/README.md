# Runbooks

Each Prometheus alert (`infra/observability/alerts.yml`) links to one of these.

| Runbook                                                        | Alerts                                             |
| -------------------------------------------------------------- | -------------------------------------------------- |
| [ledger-invariant-violation.md](ledger-invariant-violation.md) | LedgerInvariantViolation                           |
| [table-recovery.md](table-recovery.md)                         | GamePersistFailures, HandsVoided, TableLeaseLosses |
| [service-down.md](service-down.md)                             | ServiceDown, HttpErrorRate                         |
| [latency.md](latency.md)                                       | HighActionLatency                                  |
| [realtime.md](realtime.md)                                     | WebSocketResyncStorm                               |

Planned for M8: chaos drills (killing a game node mid-hand), backup and
restore, load testing.
