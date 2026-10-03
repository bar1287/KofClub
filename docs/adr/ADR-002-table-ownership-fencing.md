# ADR-002: Table actor ownership with leases and fencing tokens

Status: Accepted (updated in M4 with the implemented recovery model)
Date: 2026-10-03

## Context

A table must have exactly one authoritative owner at a time (spec §4.1,
§13.1). A plain Redis lock is unsafe: a paused/partitioned node can keep
writing after its lock expired.

## Decision

- Leases live in PostgreSQL (`table_leases`: `table_id`, `owner_node_id`,
  `owner_url`, `epoch`, `expires_at`), the same store whose writes they guard.
- Acquire: one atomic upsert (`ON CONFLICT DO UPDATE … WHERE` the lease has
  expired or is already ours, `RETURNING epoch`); every acquisition increments
  the epoch (also when a node re-acquires after a restart).
- Renew every TTL/3 (TTL default 10 s); a failed renewal stops the actor.
- **Fencing**: every durable game write runs in `InFencedTx`, which first
  `SELECT … FOR SHARE` the lease row and verifies `(owner_node_id, epoch)`.
  The share lock blocks a concurrent takeover until the write commits; after
  a takeover the old owner's next write fails with `ErrFenced` and its actor
  stops. A stale node therefore can never settle a hand or move chips.
- **Per-action durability**: each accepted command (and timer action) is
  committed — command id, public events, settlement when the hand ends —
  before any event is published. The actor applies commands to a clone of
  the table and swaps it in only after the commit (no memory/database
  divergence on failed writes).
- **Recovery by deterministic replay**: the deck (with its salt) is stored
  AES-256-GCM encrypted in `hands.deck_enc` at hand start. A new owner
  decrypts it, rebuilds the hand from `hands`/`hand_players`, replays the
  persisted `PLAYER_ACTED` events and verifies that every replayed action
  reproduces the persisted event exactly. The hand then continues from the
  same state with the same sequence numbers. If anything fails (decryption,
  divergence), the hand is **voided** instead: nothing was settled, stacks
  return to their start-of-hand values, `HAND_VOIDED` is emitted.
- **Failover**: every node runs an orphan scan (default every 5 s) that
  adopts open tables with seated players or unfinished hands whose lease
  expired, so timers and hands continue without client action.
- **Routing**: a node asked about a table it does not own answers
  `TABLE_UNAVAILABLE` with `ownerUrl`; callers retry there.
- **Draining** (deploys): a draining node keeps serving requests, stops
  starting new hands, and stops/releases each table once its current hand
  completes; another node adopts it immediately.

## Consequences

- One extra indexed row lock and one transaction per action (~ms). Measured
  latency is tracked by `game_command_latency_seconds`; batching can be added
  later if it becomes a bottleneck.
- Lease renewal load grows with active tables; at the 500–5k stage the
  registry may move to a dedicated store, but fencing must stay inside the
  durable write path.
- Mid-hand crashes are invisible to players beyond a short pause (roughly
  the lease TTL plus the orphan-scan interval), and never create or destroy chips.
