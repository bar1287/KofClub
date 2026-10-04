# ADR-016: Tournaments on the shared table infrastructure

Status: Accepted
Date: 2026-10-04

## Context

Spec §16 M10 asks for "blind schedule, registration, reseating, table
balancing, virtual payouts"; complex formats are a non-goal (Appendix C).
Tournaments span several tables that may be owned by different game nodes
(ADR-002), must keep chip accounting exact (ADR-003), must never touch real
money (ADR-006), and must survive node crashes like cash tables do.

## Decision

**Ownership.** The control-api tournament directory writes `tournaments`,
`tournament_registrations` and the tournament's rows in `tables` (created
up front: `ceil(maxPlayers / seatsPerTable)` tables, hidden from cash
lobbies). The game service writes `tournament_runtime`,
`tournament_entries` and `tournament_transfers`. The API status is the
runtime's status once it exists, otherwise the directory's.

**Money vs. tournament chips.** Buy-ins move club chips from the wallet to a
per-tournament `TOURNAMENT_POOL` ledger account (`TOURNAMENT_BUY_IN`);
unregistering/cancelling refunds them (`TOURNAMENT_REFUND`, reference
`tournament-refund:<registration>` used by both services, so a buy-in is
refunded at most once); the finish pays the pool out in one
`TOURNAMENT_PAYOUT`. `ledger_post` validates the three flows. Stacks at
tournament tables are tournament chips: hands are not settled in the
ledger; instead every write verifies that seat stacks (at hand boundaries)
plus chips in transit equal `entrants x startingStack`.

**Start.** Every node polls for due tournaments (full sit-and-go, scheduled
time, or a staff start request) and starts one in a single transaction that
locks the directory row: registrations become entries, the pool balance is
checked against the buy-ins, players are drawn into seats with
`crypto/rand` (fewest tables, sizes within one). A scheduled tournament
still short of `minPlayers` is cancelled and refunded instead. Tables of a
tournament that has not started refuse activation.

**Play.** Tournament tables are ordinary table actors with a tournament mode:
blinds follow the level schedule (wall-clock levels from the start; the
level in effect when a hand starts applies to the whole hand), absent
players are dealt in and folded immediately, and nobody can buy in or cash
out. Pure rules live in `go/tournament` (schedule, payouts, places, seating,
balancing) with simulation tests, like `go/poker`.

**Eliminations and the finish** happen in the hand-completion transaction
under a lock on the runtime row: busted players get places (larger
hand-start stack finishes higher; equal stacks share the better place and
split the prizes of the places they span), and when one player remains the
same transaction awards first place, pays out and marks the tournament
finished. The actor commit was generalized (`commitTx`) so a transaction can
decide the events it emits.

**Balancing.** Between its own hands a table recomputes, under the runtime
lock, whether it must break (when fewer tables would seat everyone, the
smallest table breaks) or give players to the smallest table (difference
of two or more). A table never writes another table's seats: it deletes its
own seat and writes a `tournament_transfers` row (seat reserved at the
destination); the destination claims arrivals into seats in its own fenced
transaction (polling, plus an immediate local wake). Players moving are
those due to post the big blind soonest.

## Consequences

- Decisions taken by different tables (possibly on different nodes) are
  serialized by the runtime row lock and always see each other's committed
  effects; crashes leave seats, transfers and entries durable for the next
  owner (tested with a node crash mid-tournament).
- Fixed structures keep the scope small: a standard blind progression from
  the level-1 blinds (doubling after level 20), a fixed payout table (about
  the top 15%), no antes, rebuys, add-ons, late registration, breaks,
  hand-for-hand play or deal-making.
- Levels change between hands on the wall clock; tables do not synchronize
  hands, so simultaneous eliminations at different tables are ordered by
  commit time.
- The control-api mirrors the schedule and payout table in TypeScript for
  display; both sides are pinned by `go/tournament/testdata/golden.json`.
- Polling adds one cheap query per tournament table per second
  (`TOURNAMENT_POLL_INTERVAL`) and one scan per node
  (`TOURNAMENT_SCAN_INTERVAL`).
