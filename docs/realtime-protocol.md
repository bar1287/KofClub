# Realtime protocol (client ↔ realtime-gateway)

WebSocket endpoint: `GET /ws` on the realtime-gateway (`ws://localhost:4100/ws`
locally; `wss://` in deployed environments). Frames are UTF-8 JSON objects
with a `type` discriminator, camelCase fields and integer chip amounts.
Canonical schemas: [`packages/contracts/openapi/realtime.yaml`](../packages/contracts/openapi/realtime.yaml)
(TypeScript and Go types are generated from it; Go integration tests validate
every frame the gateway sends against it). Semantics: ADR-004.

## Connection lifecycle

```
client                                   gateway
  | -- WebSocket upgrade (Origin checked) -->|
  | -- HELLO {accessToken, clientVersion} -->|  verify EdDSA JWT, revocation
  |<-- WELCOME {connectionId, userId, heartbeatIntervalMs, tokenExpiresAt}
  | -- SUBSCRIBE_TABLE {tableId, lastSeenSeq?} -> authorize via control-api
  |<-- TABLE_SNAPSHOT | replayed TABLE_EVENTs
  |<-- SUBSCRIBED {mode, seq}
  |<-- TABLE_EVENT {seq, event} ...          ordered, per-viewer
  | -- COMMAND {requestId, tableId, expectedSeq?, command} -->
  |<-- COMMAND_RESULT {requestId, accepted, duplicate, seq, error?}
  | -- AUTH {accessToken} (before expiry) -->|
  |<-- WELCOME (refreshed tokenExpiresAt)
```

- The first frame must be `HELLO` within 10 s, otherwise the socket closes
  with `4408`. Any other first frame, an invalid/expired token or a revoked
  session closes with `4401` after an `ERROR` frame.
- The access token is only sent in frames, never in the URL.
- Before `tokenExpiresAt` the client refreshes its token over HTTP
  (`POST /v1/auth/refresh`) and sends `AUTH`. Without it the connection is
  closed with `4401` (`AUTH_TOKEN_EXPIRED`) at expiry. `AUTH` must keep the
  same user.
- Logout/session revocation closes live connections immediately (Redis
  `session:revoked` channel) and is checked at `HELLO`.
- Heartbeats: the gateway sends WebSocket pings every
  `heartbeatIntervalMs`; clients may also send `PING {nonce}` and receive
  `PONG {nonce}` to measure latency.

## Subscriptions, ordering and resync

Each table has a monotonically increasing `seq` assigned by the table actor.
Every `TABLE_EVENT` carries its `seq`; a `TABLE_SNAPSHOT` carries the `seq`
it reflects.

| Subscribe with                             | Gateway response                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| no `lastSeenSeq`                           | `TABLE_SNAPSHOT` (seq S), then every event with seq > S, then `SUBSCRIBED {mode: SNAPSHOT}`      |
| `lastSeenSeq` L within the retained window | the missed events L+1… (replay), then `SUBSCRIBED {mode: REPLAY, replayed: n}`                   |
| `lastSeenSeq` outside the window           | `RESYNC_REQUIRED {reason: EVENTS_NOT_RETAINED}`, `TABLE_SNAPSHOT`, `SUBSCRIBED {mode: SNAPSHOT}` |

The gateway guarantees a gap-free, duplicate-free, ordered stream per
subscription. If continuity is lost on its side (internal stream reset,
detected gap, client queue overflow) it sends `RESYNC_REQUIRED` with
`SEQUENCE_GAP`/`FEED_RESET` followed by a fresh `TABLE_SNAPSHOT`.

Client rules (spec §8.1, §12.1):

1. Track `lastSeq` per table; apply events only if `seq == lastSeq + 1`.
2. On a gap, resubscribe with `lastSeenSeq = lastSeq`.
3. A snapshot **replaces** local state (never merge).
4. On reconnect: `HELLO`, then `SUBSCRIBE_TABLE` with `lastSeenSeq` for every table.
5. Disable action buttons while the connection or table state is uncertain.

The reference implementation of these rules is the web client's
`apps/web/src/lib/realtime/client.ts` (connection, auth refresh, backoff,
resume, command re-send with the same `requestId`) and
`apps/web/src/lib/table/state.ts` (ordered reducer); see ADR-012.

## Commands

```json
{
  "type": "COMMAND",
  "requestId": "<uuid>",
  "tableId": "<uuid>",
  "expectedSeq": 1442,
  "command": { "kind": "RAISE", "amount": 1200 }
}
```

- `requestId` is the command's idempotency key (the spec's EventID). Resending
  the same `requestId` (e.g. after a reconnect) returns the original result
  with `duplicate: true` and never applies the action twice — also across
  game-node failovers (accepted ids are persisted).
- `kind`: `FOLD`, `CHECK`, `CALL`, `BET`, `RAISE`, `ALL_IN`, `SIT_OUT`, `SIT_IN`.
  `amount` is the **"to" amount** for `BET`/`RAISE` (total street commitment).
- `expectedSeq` (recommended) is the last seq the client applied. It is
  rejected with `STALE_GAME_STATE` (details: `currentSeq`, `turnSeq`) when it
  predates the current turn (`TURN_STARTED`) or is ahead of the table; the
  client should resync.
- The player identity always comes from the authenticated connection, never
  from the frame.
- `COMMAND_RESULT` may arrive before or after the resulting `TABLE_EVENT`s;
  clients reconcile by `seq`.
- Commands are rate limited per connection (10/s, burst 20 → `RATE_LIMITED`).

## Table events (`TABLE_EVENT.event.kind`)

| Kind                    | Public fields                                                         | Private (recipient only)       |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------ |
| `PLAYER_SEATED`         | seat, userId, username, stack                                         |                                |
| `PLAYER_LEFT`           | seat, userId, reason (LEFT/BUSTED/TABLE_CLOSED), cashOut              |                                |
| `PLAYER_SITTING_OUT`    | seat, userId, sittingOut, reason                                      |                                |
| `HAND_STARTED`          | handId, handNo, button/blind seats, blinds, deckCommitment, players   |                                |
| `BLIND_POSTED`          | seat, blind, amount, allIn, stack, pot                                |                                |
| `HOLE_CARDS_DEALT`      | seats                                                                 | `cards` (own two cards)        |
| `TURN_STARTED`          | seat, street, currentBet, minRaise, pot, deadline, timeoutMs          | `legalActions` (acting player) |
| `PLAYER_ACTED`          | seat, action, added, streetBet, stack, allIn, pot, timeout            |                                |
| `UNCALLED_BET_RETURNED` | seat, amount, stack, pot                                              |                                |
| `STREET_DEALT`          | street, cards, board                                                  |                                |
| `CARDS_REVEALED`        | seat, cards, description, bestFive                                    |                                |
| `POT_AWARDED`           | potIndex, amount, eligibleSeats, winners, description                 |                                |
| `HAND_COMPLETED`        | handId, handNo, board, showdown, results                              |                                |
| `HAND_VOIDED`           | handId, handNo, reason                                                |                                |
| `TABLE_CLOSED`          | (none) — no new hands or players; seats are cashed out after the hand |                                |

Unrevealed cards never appear in public payloads, snapshots of other
viewers, logs or the persisted event log (ADR-008). Spectating club members
receive the public stream only.

## Errors and close codes

`ERROR {code, message, requestId?, tableId?}` uses the shared error-code
catalogue (e.g. `NOT_CLUB_MEMBER`, `CLUB_BANNED`, `TABLE_NOT_FOUND`,
`VALIDATION_FAILED`, `TABLE_UNAVAILABLE`).

| Close code | Meaning                                   | Client action                                 |
| ---------- | ----------------------------------------- | --------------------------------------------- |
| 4401       | authentication failed / expired / revoked | refresh or log in, reconnect                  |
| 4408       | no HELLO within 10 s                      | reconnect                                     |
| 4001       | client too slow (send queue full)         | reconnect and resume with `lastSeenSeq`       |
| 1012       | gateway restarting (drain)                | reconnect (backoff) and resume                |
| 1001/1006  | network loss                              | reconnect with exponential backoff and resume |

## Gateway internals

- One internal event stream per table per gateway instance
  (`GET /internal/v1/tables/{id}/stream` on the owning game node), with a
  ring of recent events (default 1024) for replays; streams reconnect with
  `after=lastSeq` and reset (forcing client resyncs) when continuity is lost.
- Authorization (`SUBSCRIBE_TABLE`, `COMMAND`) asks control-api
  (`GET /internal/v1/tables/{id}/access`) and caches decisions ~15 s.
- Per-connection bounded send queue (2048 frames); overflow disconnects the
  client rather than blocking the table feed.
- Metrics: `ws_connections`, `ws_table_subscriptions`, `gateway_table_feeds`,
  `ws_frames_in_total`, `ws_frames_out_total`, `ws_resyncs_total`,
  `ws_auth_failures_total`, `ws_slow_consumer_disconnects_total`,
  `ws_command_latency_seconds`.
