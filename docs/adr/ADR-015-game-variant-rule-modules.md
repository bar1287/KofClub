# ADR-015: Game variants as rule modules inside the engine

Status: Accepted
Date: 2026-10-04

## Context

Spec §16 M9 asks for Pot-Limit Omaha as a "separate rule module sharing
generic table infrastructure". Hold'em and Omaha are both flop games: blinds,
button movement, turn order, streets, all-in runouts, side pots, odd-chip
rules, settlement, persistence, replay and failover are identical. They
differ in three places only: how many hole cards are dealt, how a hand is
evaluated (Omaha: exactly two hole cards plus exactly three board cards) and
how much may be bet (pot limit instead of no limit).

Options considered:

1. A copy of the engine per game. Duplicates the most delicate code
   (side pots, incomplete raises, recovery) and doubles the test burden.
2. A separate Go package per variant that wraps the Hold'em engine. The
   variant hooks sit in the middle of action validation, so a wrapper would
   need most of the engine's internals exported.
3. **A small rule interface inside `go/poker`, selected per hand.**

## Decision

Option 3. `go/poker/variant.go` defines `GameType` (`NLHE`, `PLO`; the empty
value means NLHE for backward compatibility) and an unexported `rules`
interface with three hooks:

- `holeCards()` — 2 or 4 cards, dealt one per round from the left of the
  button;
- `best(hole, board)` — `EvaluateBest` over all seven cards, or
  `EvaluateOmaha` (60 two-plus-three combinations);
- `capTo(hand, seat)` — the largest street commitment a bet or raise may
  reach: unlimited, or `currentBet + pot + amountToCall` (pot limit).

`HandConfig.Game` / `TableConfig.Game` choose the module; everything else
(state machine, legal actions, pots, events, `Table`, recovery) is shared.
The game is part of the table directory row (`tables.game_type`, fixed at
creation) **and** of every hand record (`hands.game_type`, migration
000008), so replay after failover and history never depend on the table's
current configuration. Wire contracts carry `gameType` on `TableInfo`,
`HAND_STARTED`, `Table` and `HandSummary`; `HoleCardsDealt`, `CardsRevealed`,
`shownCards` and history hole cards are arrays of 2 or 4 cards.

`ALL_IN` stays an intent: in a pot-limit game it is offered only when the
whole stack fits under the limit; an all-in above the limit is rejected
with `INVALID_RAISE`. `LegalAction.maxTo` is the pot limit when the stack is
deeper.

## Consequences

- One engine, one property-test harness: the random-hand invariants
  (conservation, legal actions accepted at both ends, illegal rejected,
  side-pot bounds, deterministic replay) run for both games.
- New flop variants (e.g. Pot-Limit Hold'em, five-card Omaha) are a new
  `rules` implementation, a contract enum value and a `CHECK` constraint
  change. Hi/lo split games would additionally need a pot-splitting hook and
  are out of scope.
- Wire compatibility: `gameType` is additive; clients that assumed two hole
  cards must size card arrays from the payload (the web client does).
- Down-migrating 000008 refuses while PLO tables exist rather than silently
  rewriting them as Hold'em.
