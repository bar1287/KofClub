# Game engine (`go/poker`)

The poker rules live in one pure Go package with **no dependencies on
networking, persistence, time, environment or UI** (enforced by
`go/poker/deps_test.go`). The table actor in `apps/game-service` wraps it with
timers, persistence and broadcasting; it never re-implements rules.

## Determinism

`NewHand(HandConfig)` + a sequence of `Act(Action)` calls fully determine a
hand. The only randomness is the deck order passed in `HandConfig.Deck`:

- Production shuffles with `Shuffle(deck, crypto/rand.Reader)` —
  Fisher–Yates with rejection-sampled uniform integers (no modulo bias, no
  `math/rand`, no timestamps, no client entropy).
- Tests use a seeded ChaCha8 reader, so any hand can be replayed exactly.
- `DeckCommitment(deck, salt)` (SHA-256 of salt‖deck order) is persisted at
  hand start for audit without revealing cards.

## Cards and evaluation

- `Card` is `0..51` = `(rank-2)*4 + suit`; JSON form is `"As"`, `"Td"`.
- `Evaluate(cards)` returns a `HandValue` (`uint32`): higher always wins,
  equal values tie. Layout `category<<20 | five 4-bit ranks`.
- `EvaluateBest` also returns the best five cards (for showdown display).
- Verified by: exhaustive enumeration of all 2,598,960 five-card hands
  (exact category frequencies, exactly 7,462 distinct values); a 200,000-hand
  cross-check against an independent sort-based reference evaluator; and an
  opt-in full enumeration of all 133,784,560 seven-card hands
  (`POKER_EXHAUSTIVE=1 go test -run SevenCard ./go/poker`, ~25 s) matching
  the known seven-card category frequencies.

## Hand lifecycle

```
NewHand: HAND_STARTED -> BLIND_POSTED x2 -> HOLE_CARDS_DEALT (private, per seat)
  PREFLOP betting -> STREET_DEALT(FLOP) -> betting -> STREET_DEALT(TURN) -> betting
  -> STREET_DEALT(RIVER) -> betting -> CARDS_REVEALED* -> POT_AWARDED* -> HAND_COMPLETED
```

- The table-level phases (`WAITING_FOR_PLAYERS`, `HAND_IN_PROGRESS`,
  `HAND_COMPLETE`) are in `Table`; settlement (ledger) happens in the actor.
- When every remaining player folds except one: uncalled chips are returned,
  the pot is awarded uncontested and **no cards are revealed**.
- When no further betting is possible (everyone but at most one player is
  all-in and bets are matched), the remaining streets are dealt immediately
  (all-in runout) and the hand goes to showdown.
- Cards are dealt one at a time starting left of the button; a burn card
  precedes each street.

## Positions and order

| Situation                 | Rule                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 3+ players                | SB = first seat left of the button, BB = next; preflop first to act = left of BB; postflop = first active left of the button |
| Heads-up                  | Button posts the SB and acts first preflop; the BB acts first postflop                                                       |
| Button                    | Moves to the next dealt-in seat clockwise each hand (simplified: no dead button)                                             |
| New players               | Dealt into the next hand without posting a missed blind (simplified)                                                         |
| Sitting out / empty seats | Not dealt in                                                                                                                 |

## Betting rules (no-limit)

- Actions: `FOLD`, `CHECK`, `CALL`, `BET`, `RAISE`, and the convenience
  intent `ALL_IN` (resolved to CALL/BET/RAISE for the whole stack).
- **Amounts are "to" amounts**: `BET`/`RAISE` `amount` = the player's total
  commitment in the current betting round after the action.
- Minimum bet = big blind; minimum raise increment = size of the last full
  bet/raise in the round (at least the big blind). A player may always go
  all-in for less.
- **Incomplete all-in raises do not reopen betting**: a player who has
  already acted may raise again only when the total increase since their
  last action is at least a full raise (TDA rule; cumulative short all-ins
  can add up to a full raise).
- The BB has the option to check or raise when the pot is limped.
- Short blinds: a player who cannot cover a blind posts all-in for less; the
  amount to call is still the full big blind.
- Raising is not offered when no opponent could respond (everyone else is
  all-in or folded).
- `FOLD` is always legal; the server's timeout default is CHECK when legal,
  otherwise FOLD (`Hand.DefaultAction`).
- Invalid intents return typed errors (`NOT_YOUR_TURN`, `ILLEGAL_ACTION`,
  `INVALID_RAISE`, `HAND_NOT_ACTIVE`, `PLAYER_NOT_SEATED`) and never mutate state.

`Hand.LegalActions()` lists what the current actor may do:
`{kind, amount}` for CALL (chips to add) and ALL_IN (resulting "to" amount),
`{kind, minTo, maxTo}` for BET/RAISE. Clients render buttons from this list;
the server re-validates every action.

## Pots

- At the end of each betting round the unmatched part of the highest bet is
  returned (`UNCALLED_BET_RETURNED`).
- Pots are derived from total contributions (`BuildPots`): one pot per
  distinct contribution level of live players; eligibility = live and
  contributed at least that level. Folded chips are dead money in the pots
  their contribution reaches. Adjacent pots with identical eligibility merge.
- Each pot goes to the best hand among its eligible players (`AwardPot`);
  ties split evenly and **odd chips go one at a time to the tied winners
  closest to the left of the button**.
- Showdown reveal order: last aggressor of the final betting round first,
  otherwise first live player left of the button. All live hands are shown
  (no mucking in the MVP).

## Invariants (tested)

`go/poker/property_test.go` plays 12,000 random hands (2–9 players, mixed
short/deep stacks, varied sizing; `-short` runs 2,000) and checks after every
action:

- no card appears twice; board size matches the street;
- per player `stack + contributed == starting stack` during the hand (chips
  conserved), no negative values;
- every action listed by `LegalActions` is accepted at both ends of its
  sizing range; out-of-turn and mis-sized actions are rejected without
  mutating state;
- at completion: Σ ending stacks = Σ starting stacks, Σ net = 0, pot shares
  sum to pot amounts, total awarded = total contributed;
- folded players never win and never reveal cards; every live player at
  showdown is revealed exactly once;
- no player wins more than `Σ_j min(contribution_j, own contribution)`
  (side-pot eligibility bound);
- replaying the same deck and actions yields identical events.

`TestTableSessionConservesChips` plays consecutive hands at one table and
checks table-wide conservation and button movement.

## Recovery semantics

The engine is deterministic, so the actor can rebuild an unfinished hand
from its configuration (`HandConfig`) and the persisted actions, then attach
it to a restored table with `Table.ResumeHand()`; see ADR-002.

`Table.AbortHand()` voids an unfinished hand and restores every dealt-in
player's stack to its value at hand start. The actor uses it when a hand
cannot be completed safely (e.g. lost table ownership or a failed durable
write): no settlement is posted, so the ledger never sees a partial hand and
chips are neither created nor destroyed. Hand numbers keep increasing, so a
voided hand id is never reused.

## Not yet implemented

Antes, straddles, dead-button/missed-blind rules, run-it-twice, mucking at
showdown, Pot-Limit Omaha (M9 — separate rule module sharing the table
infrastructure), tournaments (M10).
