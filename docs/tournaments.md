# Tournaments (M10)

Virtual-chip tournaments (ADR-006: no monetary value) built on the cash
table infrastructure. Design decisions: [ADR-016](adr/ADR-016-tournaments.md).

## Lifecycle

```
REGISTERING --(full SNG | scheduled time | staff start, >= minPlayers)--> RUNNING --(one player left)--> FINISHED
REGISTERING --(staff cancel | scheduled time with < minPlayers)--> CANCELLED (all buy-ins refunded)
```

| Step       | Who                         | What happens                                                                                  |
| ---------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| Create     | club ADMIN+ (control-api)   | tournament row + its tables (hidden from the cash lobby), audit `TOURNAMENT_CREATED`          |
| Register   | club member (control-api)   | `TOURNAMENT_BUY_IN` wallet -> prize pool; one active registration per player                  |
| Unregister | registered player           | `TOURNAMENT_REFUND` pool -> wallet (before the start only)                                    |
| Start      | game service (any node)     | registrations -> entries, random seat draw, runtime `RUNNING`, tables activated               |
| Play       | game service (table actors) | level blinds, eliminations with places, balancing/breaking via transfers                      |
| Finish     | game service (last hand)    | first place, `TOURNAMENT_PAYOUT` pool -> winners' wallets, runtime `FINISHED`, tables emptied |
| Cancel     | club ADMIN+ (before start)  | refunds, directory `CANCELLED`, audit `TOURNAMENT_CANCELLED`                                  |

## Structure

- **Blinds:** level 1 is configured (`smallBlind`/`bigBlind`, big blind at
  most a tenth of the starting stack); later levels multiply level 1 by
  1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200,
  then keep doubling (capped at 10^12). Levels last `levelDurationSec` of
  wall-clock time from the start; a new level applies from the next hand.
  No antes (the engine has none yet).
- **Payouts** (share of the prize pool by place; remainder chips to first):

  | Entrants | Paid places | Shares (%)                                |
  | -------- | ----------- | ----------------------------------------- |
  | 2-3      | 1           | 100                                       |
  | 4-6      | 2           | 65, 35                                    |
  | 7-10     | 3           | 50, 30, 20                                |
  | 11-20    | 5           | 40, 25, 16, 11, 8                         |
  | 21-35    | 8           | 32, 20, 14, 10, 8, 6.5, 5.5, 4            |
  | 36-100   | 12          | 27, 17, 12, 9, 7.5, 6, 5, 4, 3.5, 3, 3, 3 |

- **Places:** players busted in the same hand are ranked by their stack at
  the start of that hand; equal stacks share the better place and split the
  prizes of the places they span (leftover chips one each in player-id
  order).
- **Seating and balancing:** the fewest tables that seat everyone, sizes
  within one. Between its hands a table breaks when fewer tables would do
  (the smallest one, ties: highest number) or gives players to the smallest
  table while it has two or more players more. Moved players are those due
  to post the big blind next and take the lowest free seat. The final table
  forms automatically.
- **Absent players** are dealt in; after two timeouts they are sat out and
  folded instantly each hand (they can sit back in). There is no cash-out
  from a tournament table.

## Data and invariants

| Table                      | Writer       | Notes                                                       |
| -------------------------- | ------------ | ----------------------------------------------------------- |
| `tournaments`              | control-api  | definition, directory status, staff start request           |
| `tournament_registrations` | control-api  | ACTIVE / UNREGISTERED / REFUNDED, one ACTIVE per player     |
| `tables` (tournament rows) | control-api  | created with the tournament, `tournament_table_no`          |
| `tournament_runtime`       | game service | RUNNING / FINISHED / CANCELLED, entrants, pool, total chips |
| `tournament_entries`       | game service | place, prize, current table                                 |
| `tournament_transfers`     | game service | players (and their chips) moving between tables             |

Checked on every write: seat stacks of the tournament's tables (at hand
boundaries) + transfers = `entrants x startingStack`; the pool equals the
buy-ins at the start and pays out exactly to zero; ledger invariants hold.

## API

`POST/GET /v1/clubs/{clubId}/tournaments`, `GET /v1/tournaments/{id}`,
`POST /v1/tournaments/{id}/register|unregister|start|cancel`
(contract: `packages/contracts/openapi/control-api.yaml`). Tournament tables
use the normal realtime protocol; snapshots and `HAND_STARTED` carry a
`tournament` section (level, blinds, next level), and `PLAYER_LEFT` uses the
reasons `MOVED` (with `toTableId`), `ELIMINATED` and `FINISHED` (with
`place`).

Following moves: a moved player's client switches to `toTableId` and waits
there to be seated. If that table breaks before seating them, it redirects
the transfer and emits `PLAYER_LEFT MOVED` with `seat: 0` (never seated
there) and the new `toTableId`. Events are not replayed to a fresh
subscription, so a client that subscribes just after such a move sees a
snapshot without the player: while unseated at a running tournament's table,
clients re-read `myTableId` from `GET /v1/tournaments/{id}` (the source of
truth; null once eliminated) and follow it.

## Operations

| Setting                    | Default | Meaning                                                |
| -------------------------- | ------- | ------------------------------------------------------ |
| `TOURNAMENT_SCAN_INTERVAL` | 1s      | how often each node looks for due tournaments          |
| `TOURNAMENT_POLL_INTERVAL` | 1s      | how often a tournament table checks arrivals/balancing |
