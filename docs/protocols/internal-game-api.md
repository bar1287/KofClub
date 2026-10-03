# Internal game-service API

Service-to-service HTTP API of `apps/game-service`, used by `control-api`
(seating) and `realtime-gateway` (snapshots, events, commands). It is only
reachable on the private network; the edge never routes `/internal`.

- Authentication: `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`
  (constant-time comparison). Requests without it get `401 AUTH_REQUIRED`.
- Correlation: `X-Request-Id` is propagated and echoed.
- Errors: the standard envelope `{"error":{"code","message","requestId","details"}}`
  with codes from the shared catalogue.
- Ownership: the node that receives a request for a table either already
  runs its actor, activates it (acquires the lease, restores state), or
  answers `503 TABLE_UNAVAILABLE` with `details.ownerUrl` pointing at the
  owning node. Clients retry once against `ownerUrl`.

| Method | Path                                                  | Body / query                                       | Result                                                                                |
| ------ | ----------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| POST   | `/internal/v1/tables/{tableId}/seat`                  | `{userId, seatNo (0 = any), buyIn, requestId}`     | `{seatNo, stack, seq}`                                                                |
| POST   | `/internal/v1/tables/{tableId}/leave`                 | `{userId, requestId}`                              | `{status: LEFT \| LEAVING_AFTER_HAND, cashOut}`                                       |
| POST   | `/internal/v1/tables/{tableId}/sitting-out`           | `{userId, sittingOut}`                             | `{seq, sittingOut}`                                                                   |
| POST   | `/internal/v1/tables/{tableId}/commands`              | `{userId, commandId, expectedSeq?, kind, amount?}` | `{commandId, accepted, duplicate, seq}`                                               |
| GET    | `/internal/v1/tables/{tableId}/snapshot?viewer=`      |                                                    | `TableSnapshot` (realtime.yaml)                                                       |
| GET    | `/internal/v1/tables/{tableId}/events?after=&viewer=` |                                                    | `{seq, events:[{seq, handId, serverTime, event}]}` or `409 STALE_GAME_STATE` (resync) |
| GET    | `/internal/v1/tables/{tableId}/route`                 |                                                    | `{tableId, ownerUrl, epoch?, clubId?}`                                                |
| GET    | `/internal/v1/tables`                                 |                                                    | `{tables:[ids running on this node]}`                                                 |

Command kinds: `FOLD`, `CHECK`, `CALL`, `BET`, `RAISE`, `ALL_IN` (amount =
"to" amount for BET/RAISE), `SIT_OUT`, `SIT_IN`.

Command semantics:

- `commandId` (UUID, client generated) is the idempotency key: repeating it
  returns the original result with `duplicate: true` and never re-applies.
  Accepted command ids are persisted (`table_commands`) and reloaded on
  failover, so retries after a node crash are also safe.
- `expectedSeq` (optional) guards against stale clients: it must be at least
  the `seq` of the current turn's `TURN_STARTED` event and not ahead of the
  table; otherwise `409 STALE_GAME_STATE` with `details.currentSeq`.
- Rejections: `NOT_YOUR_TURN`, `ILLEGAL_ACTION`, `INVALID_RAISE`,
  `HAND_NOT_ACTIVE`, `PLAYER_NOT_SEATED`, `STALE_GAME_STATE`,
  `ACTION_ALREADY_PROCESSED`; `503 TABLE_UNAVAILABLE` is retryable.

Authorization split: control-api checks club membership/bans before calling
`seat`; the gateway checks table access before forwarding subscriptions and
commands (M5). The game service enforces game rules, seat ownership, turn
order and chip accounting.
