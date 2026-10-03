# ADR-004: WebSocket event ordering and reconnect semantics

Status: Accepted
Date: 2026-10-03

## Context

Clients must never depend on perfectly synchronized state; they must detect
gaps, recover missed events, and resync after long disconnections (spec §8).

## Decision

- Each table has a monotonically increasing `tableSeq` assigned by the table
  actor. Every `TABLE_EVENT` carries `seq`; snapshots carry the `seq` they
  reflect.
- The game node keeps a bounded in-memory window of recent events per table.
  On `SUBSCRIBE_TABLE` with `lastSeenSeq`, the gateway replays retained
  events (`seq > lastSeenSeq`), otherwise sends `RESYNC_REQUIRED` followed by
  a fresh `TABLE_SNAPSHOT`. A client replaces (never merges) its state on a
  snapshot.
- Clients detect gaps (`seq != lastSeq + 1`) and resubscribe with
  `lastSeenSeq`.
- Commands carry a client-generated `commandId` (the EventID) and optional
  `expectedSeq`. The actor remembers results per `commandId`; a duplicate
  returns the original result with `duplicate: true` and never re-applies.
  A mismatched `expectedSeq` is rejected with `STALE_GAME_STATE`.
- Private data (hole cards) is delivered only inside per-recipient payloads.

## Consequences

- The gateway is stateless with respect to game truth; restarting it only
  forces clients to reconnect and resync.
- The retention window bounds memory; long-offline clients get snapshots.
