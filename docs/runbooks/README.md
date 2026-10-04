# Runbooks

Each Prometheus alert (`infra/observability/alerts.yml`) links to one of these.

| Runbook                                                        | Alerts                                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [ledger-invariant-violation.md](ledger-invariant-violation.md) | LedgerInvariantViolation                                                                                   |
| [table-recovery.md](table-recovery.md)                         | GamePersistFailures, HandsVoided, TableLeaseLosses                                                         |
| [service-down.md](service-down.md)                             | ServiceDown, HttpErrorRate                                                                                 |
| [latency.md](latency.md)                                       | HighActionLatency                                                                                          |
| [realtime.md](realtime.md)                                     | WebSocketResyncStorm                                                                                       |
| [tournaments.md](tournaments.md)                               | TournamentInvariantViolation, TournamentTransferStuck, TournamentStartOverdue, TournamentOperationFailures |

Procedures and drills:

- [backup-restore.md](backup-restore.md) — logical backups, restore, the
  automated restore drill (`make backup-restore-check`).
- [failover-drill.md](failover-drill.md) — killing a game node mid-hand
  (automated in `tests/chaos`).
- [deck-key-rotation.md](deck-key-rotation.md) — rotating the card
  encryption key, re-sealing stored cards, retiring a key.
- Load baseline: [../performance.md](../performance.md) (`make load-smoke`).
