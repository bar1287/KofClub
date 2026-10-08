package table

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	ledger "github.com/bar1287/kofclub/go/ledger-client"
	"github.com/bar1287/kofclub/go/poker"
	"github.com/bar1287/kofclub/go/tournament"
)

// Tournament tables (M10, ADR-016). A tournament table is an ordinary table
// actor with four differences:
//
//   - blinds follow the tournament's level schedule (set before each hand);
//   - stacks are tournament chips, not ledger chips: nothing is settled in
//     the ledger per hand, and the chips at all of the tournament's tables
//     plus the chips of players moving between tables are verified to equal
//     the chips put in play;
//   - busted players are eliminated with a finishing place; the last
//     elimination finishes the tournament and pays the prize pool out in
//     the same transaction;
//   - between hands the table rebalances: it moves players to other tables
//     through tournament_transfers (never writing another table's seats),
//     and seats players transferred to it.
//
// Eliminations, balancing and the finish lock the tournament's runtime row,
// so decisions taken by different tables (possibly on different nodes) are
// serialized and always see each other's committed effects.

// ErrTournamentNotStarted is returned when a tournament table is requested
// before its tournament started (it has no players yet).
var ErrTournamentNotStarted = errors.New("table: tournament has not started")

type tourState struct {
	id         string
	name       string
	tableNo    int
	clubID     string
	structure  tournament.Structure
	startedAt  time.Time
	totalChips int64
	// inbound and finished mirror the last poll.
	inbound  int
	finished bool
	// pending holds metric increments decided inside a transaction; they
	// are applied once the hand's commit succeeded (onHandFinished).
	pending tourOutcome
}

type tourOutcome struct {
	eliminated int
	finished   bool
}

// recordHandOutcome applies the metrics of a committed tournament hand.
func (a *Actor) recordHandOutcome() {
	if a.tour == nil {
		return
	}
	o := a.tour.pending
	a.tour.pending = tourOutcome{}
	a.deps.Metrics.TournamentEliminations.Add(float64(o.eliminated))
	if o.finished {
		a.deps.Metrics.TournamentsFinished.Inc()
	}
}

func loadTourState(ctx context.Context, s *store.Store, cfg store.TableConfig) (*tourState, error) {
	t, err := store.LoadTournament(ctx, s.Pool, cfg.TournamentID, false)
	if err != nil {
		return nil, err
	}
	if t.Runtime == nil || t.Runtime.Status == "CANCELLED" {
		return nil, ErrTournamentNotStarted
	}
	return &tourState{
		id: t.ID, name: t.Name, tableNo: cfg.TableNo, clubID: t.ClubID,
		structure: tournament.Structure{SmallBlind: t.SmallBlind, BigBlind: t.BigBlind, LevelDuration: t.LevelDuration},
		startedAt: t.Runtime.StartedAt, totalChips: t.Runtime.TotalChips, finished: t.Runtime.Status == "FINISHED",
	}, nil
}

func (t *tourState) level(now time.Time) tournament.Level {
	l, _ := t.structure.LevelAt(now.Sub(t.startedAt))
	return l
}

// tournamentInfo is the tournament section of snapshots and HAND_STARTED.
type tournamentInfo struct {
	TournamentID   string    `json:"tournamentId"`
	Name           string    `json:"name"`
	TableNo        int       `json:"tableNo"`
	Status         string    `json:"status"`
	Level          int       `json:"level"`
	SmallBlind     int64     `json:"smallBlind"`
	BigBlind       int64     `json:"bigBlind"`
	NextSmallBlind int64     `json:"nextSmallBlind"`
	NextBigBlind   int64     `json:"nextBigBlind"`
	LevelEndsAt    time.Time `json:"levelEndsAt"`
}

func (t *tourState) info(now time.Time) tournamentInfo {
	l, left := t.structure.LevelAt(now.Sub(t.startedAt))
	next := t.structure.Level(l.Number + 1)
	status := "RUNNING"
	if t.finished {
		status = "FINISHED"
	}
	return tournamentInfo{
		TournamentID: t.id, Name: t.name, TableNo: t.tableNo, Status: status, Level: l.Number,
		SmallBlind: l.SmallBlind, BigBlind: l.BigBlind, NextSmallBlind: next.SmallBlind, NextBigBlind: next.BigBlind,
		LevelEndsAt: now.Add(left).UTC().Truncate(time.Millisecond),
	}
}

// verifyChips asserts chip conservation for the table's kind: ledger table
// stacks for cash tables, tournament chips for tournament tables.
func (a *Actor) verifyChips(ctx context.Context, tx pgx.Tx, next *poker.Table) error {
	if a.tour != nil {
		return store.VerifyTournamentChips(ctx, tx, a.tour.id, a.tour.totalChips)
	}
	return store.VerifyTableStacks(ctx, tx, a.cfg.ID, seatStacks(next))
}

// tourLoop polls for arrivals, balancing work and the tournament's end.
func (a *Actor) tourLoop() {
	poll := a.deps.Timing.TournamentPoll
	if poll <= 0 {
		poll = time.Second
	}
	t := time.NewTicker(poll)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			a.post(func() {
				if a.tourTick() {
					a.afterChange()
				}
			})
		case <-a.stopCh:
			return
		}
	}
}

// Wake runs a tournament tick now (another local table moved players here).
func (a *Actor) Wake() {
	a.post(func() {
		if a.tourTick() {
			a.afterChange()
		}
	})
}

// tourTick seats arriving players, rebalances between hands and clears the
// table once the tournament finished. It reports whether state changed.
func (a *Actor) tourTick() bool {
	if a.tour == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	inbound, status, err := a.deps.Store.TournamentTick(ctx, a.tour.id, a.cfg.ID)
	cancel()
	if err != nil {
		a.log.Warn("tournament_poll_failed", slog.String("error", err.Error()))
		return false
	}
	a.tour.inbound = inbound
	between := a.table.Hand() == nil || a.table.Hand().IsComplete()
	if status == "FINISHED" {
		a.tour.finished = true
		if between && len(a.table.Seats()) > 0 {
			return a.tourClear()
		}
		return false
	}
	changed := false
	if inbound > 0 {
		changed = a.tourClaim() || changed
	}
	if between {
		changed = a.tourRebalance() || changed
	}
	return changed
}

// tourClaim seats players transferred to this table.
func (a *Actor) tourClaim() bool {
	next := a.table.Clone()
	events, err := a.commitTx(next, func(ctx context.Context, tx pgx.Tx) ([]draft, error) {
		transfers, err := store.InboundTransfers(ctx, tx, a.cfg.ID, true)
		if err != nil || len(transfers) == 0 {
			return nil, err
		}
		var drafts []draft
		for _, t := range transfers {
			seat := t.SeatNo
			if _, taken := next.SeatState(seat); taken {
				free := next.FreeSeats()
				if len(free) == 0 {
					return nil, fmt.Errorf("tournament table %s is full", a.cfg.ID)
				}
				seat = free[0]
			}
			if err := next.SitDown(seat, poker.PlayerID(t.UserID), t.Stack); err != nil {
				return nil, fromEngine(err)
			}
			_ = next.SetSittingOut(seat, t.SittingOut)
			_ = next.SetMuckLosing(seat, true) // the table_seats default
			if err := store.InsertSeatState(ctx, tx, a.cfg.ID, seat, t.UserID, t.Stack, t.SittingOut); err != nil {
				return nil, err
			}
			if err := store.DeleteTransfer(ctx, tx, a.tour.id, t.UserID); err != nil {
				return nil, err
			}
			if err := store.SetEntryTable(ctx, tx, a.tour.id, t.UserID, a.cfg.ID); err != nil {
				return nil, err
			}
			a.usernames[t.UserID] = t.Username
			a.banks.seat(t.UserID)
			drafts = append(drafts, draft{kind: KindPlayerSeated, public: playerSeatedPayload{
				Kind: KindPlayerSeated, Seat: seat, UserID: t.UserID, Username: t.Username, Stack: t.Stack,
			}})
		}
		return drafts, store.VerifyTournamentChips(ctx, tx, a.tour.id, a.tour.totalChips)
	})
	if err != nil {
		a.deps.Metrics.TournamentFailures.WithLabelValues("claim").Inc()
		a.log.Warn("tournament_claim_failed", slog.String("error", err.Error()))
		return false
	}
	a.tour.inbound = 0
	if len(events) > 0 {
		a.log.Info("tournament_players_arrived", slog.Int("players", len(events)))
	}
	return len(events) > 0
}

func loads(tables []store.TournamentTable) []tournament.TableLoad {
	out := make([]tournament.TableLoad, len(tables))
	for i, t := range tables {
		out[i] = tournament.TableLoad{ID: t.ID, No: t.No, Seated: t.Seated, Inbound: t.Inbound, MaxSeats: t.MaxSeats}
	}
	return out
}

// tourRebalance moves players out of this table when the tournament needs
// it (between hands only). The plan is computed without locks first and
// recomputed under the runtime lock before anything is written.
func (a *Actor) tourRebalance() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	tables, err := store.TournamentTables(ctx, a.deps.Store.Pool, a.tour.id)
	cancel()
	if err != nil {
		a.log.Warn("tournament_tables_failed", slog.String("error", err.Error()))
		return false
	}
	if len(tournament.Rebalance(loads(tables), a.cfg.ID).Moves) == 0 {
		return false
	}

	next := a.table.Clone()
	var woken []string
	events, err := a.commitTx(next, func(ctx context.Context, tx pgx.Tx) ([]draft, error) {
		woken = woken[:0]
		rt, err := store.LockRuntime(ctx, tx, a.tour.id)
		if err != nil || rt.Status != "RUNNING" {
			return nil, err
		}
		tables, err := store.TournamentTables(ctx, tx, a.tour.id)
		if err != nil {
			return nil, err
		}
		plan := tournament.Rebalance(loads(tables), a.cfg.ID)
		if len(plan.Moves) == 0 {
			return nil, nil
		}
		maxSeats := map[string]int{}
		self := store.TournamentTable{}
		for _, t := range tables {
			maxSeats[t.ID] = t.MaxSeats
			if t.ID == a.cfg.ID {
				self = t
			}
		}
		if self.Seated != len(next.Seats()) {
			return nil, fmt.Errorf("tournament table %s: %d seats in memory, %d stored", a.cfg.ID, len(next.Seats()), self.Seated)
		}
		// Who moves: everyone when breaking; otherwise the players due to
		// post the big blind soonest.
		order := next.BigBlindOrder()
		if plan.Break {
			order = order[:0]
			for _, s := range next.Seats() {
				order = append(order, s.Seat)
			}
		}
		var inbound []store.Transfer
		if plan.Break && self.Inbound > 0 {
			if inbound, err = store.InboundTransfers(ctx, tx, a.cfg.ID, true); err != nil {
				return nil, err
			}
		}
		taken := map[string]map[int]bool{}
		freeSeat := func(table string) (int, error) {
			if taken[table] == nil {
				seats, err := store.TakenSeats(ctx, tx, table)
				if err != nil {
					return 0, err
				}
				taken[table] = seats
			}
			for n := 1; n <= maxSeats[table]; n++ {
				if !taken[table][n] {
					taken[table][n] = true
					return n, nil
				}
			}
			return 0, fmt.Errorf("tournament table %s has no free seat", table)
		}
		var drafts []draft
		for i, dest := range plan.Moves {
			seatNo, err := freeSeat(dest)
			if err != nil {
				return nil, err
			}
			woken = append(woken, dest)
			if i >= len(order) {
				// Redirect a player who was on the way to this table.
				k := i - len(order)
				if k >= len(inbound) {
					return nil, fmt.Errorf("tournament table %s: plan exceeds its players", a.cfg.ID)
				}
				if err := store.RedirectTransfer(ctx, tx, a.tour.id, inbound[k].UserID, dest, seatNo); err != nil {
					return nil, err
				}
				if err := store.SetEntryTable(ctx, tx, a.tour.id, inbound[k].UserID, dest); err != nil {
					return nil, err
				}
				// The player may already be watching this table, waiting to
				// be seated: tell them where they go instead (seat 0 = they
				// never sat down here).
				drafts = append(drafts, draft{kind: KindPlayerLeft, public: playerLeftPayload{
					Kind: KindPlayerLeft, Seat: 0, UserID: inbound[k].UserID, Reason: "MOVED", ToTableID: dest,
				}})
				continue
			}
			s, _ := next.SeatState(order[i])
			user := string(s.Player)
			if _, err := next.StandUp(s.Seat); err != nil {
				return nil, fromEngine(err)
			}
			if err := store.DeleteSeat(ctx, tx, a.cfg.ID, user); err != nil {
				return nil, err
			}
			if err := store.InsertTransfer(ctx, tx, a.tour.id, store.Transfer{
				UserID: user, FromTableID: a.cfg.ID, ToTableID: dest, SeatNo: seatNo, Stack: s.Stack, SittingOut: s.SittingOut,
			}); err != nil {
				return nil, err
			}
			if err := store.SetEntryTable(ctx, tx, a.tour.id, user, dest); err != nil {
				return nil, err
			}
			drafts = append(drafts, draft{kind: KindPlayerLeft, public: playerLeftPayload{
				Kind: KindPlayerLeft, Seat: s.Seat, UserID: user, Reason: "MOVED", ToTableID: dest,
			}})
		}
		return drafts, store.VerifyTournamentChips(ctx, tx, a.tour.id, a.tour.totalChips)
	})
	if err != nil {
		a.deps.Metrics.TournamentFailures.WithLabelValues("rebalance").Inc()
		a.log.Warn("tournament_rebalance_failed", slog.String("error", err.Error()))
		return false
	}
	a.deps.Metrics.TournamentMoves.Add(float64(len(events)))
	if len(events) > 0 {
		a.log.Info("tournament_players_moved", slog.Int("players", len(events)))
	}
	if a.deps.Wake != nil {
		for _, id := range woken {
			a.deps.Wake(id)
		}
	}
	return len(events) > 0
}

// tourClear removes the remaining seats once the tournament finished (the
// winner may sit at a table other than the one that played the last hand).
func (a *Actor) tourClear() bool {
	next := a.table.Clone()
	events, err := a.commitTx(next, func(ctx context.Context, tx pgx.Tx) ([]draft, error) {
		var drafts []draft
		for _, s := range a.table.Seats() {
			user := string(s.Player)
			place, err := store.EntryPlace(ctx, tx, a.tour.id, user)
			if err != nil {
				return nil, err
			}
			if _, err := next.StandUp(s.Seat); err != nil {
				return nil, fromEngine(err)
			}
			if err := store.DeleteSeat(ctx, tx, a.cfg.ID, user); err != nil {
				return nil, err
			}
			drafts = append(drafts, draft{kind: KindPlayerLeft, public: playerLeftPayload{
				Kind: KindPlayerLeft, Seat: s.Seat, UserID: user, Reason: "FINISHED", Place: place,
			}})
		}
		return drafts, nil
	})
	if err != nil {
		a.deps.Metrics.TournamentFailures.WithLabelValues("clear").Inc()
		a.log.Warn("tournament_clear_failed", slog.String("error", err.Error()))
		return false
	}
	return len(events) > 0
}

// tournamentHandEnd completes a hand at a tournament table: results, stack
// projections, eliminations with finishing places and, when one player is
// left, the finish with prize payouts. Places depend on eliminations at the
// other tables, so they are decided under the runtime lock.
func (a *Actor) tournamentHandEnd(next *poker.Table, evs []poker.Event) func(ctx context.Context, tx pgx.Tx) ([]draft, error) {
	hand := next.Hand()
	handID := a.handID
	players, board, resultHash := handRecord(handID, hand, evs)
	startStacks := map[string]int64{}
	for _, r := range hand.Results() {
		startStacks[string(r.Player)] = r.StartingStack
	}

	next.FinishHand()
	type bust struct {
		user string
		seat int
	}
	var busted []bust
	var busts []tournament.Bust
	for _, s := range next.Seats() {
		if s.Stack == 0 {
			user := string(s.Player)
			busted = append(busted, bust{user: user, seat: s.Seat})
			busts = append(busts, tournament.Bust{Player: user, StartingStack: startStacks[user]})
		}
	}
	for _, b := range busted {
		_, _ = next.StandUp(b.seat)
	}
	remaining := map[string]int64{}
	for _, s := range next.Seats() {
		remaining[string(s.Player)] = s.Stack
	}

	return func(ctx context.Context, tx pgx.Tx) ([]draft, error) {
		a.tour.pending = tourOutcome{}
		rt, err := store.LockRuntime(ctx, tx, a.tour.id)
		if err != nil {
			return nil, err
		}
		if rt.Status != "RUNNING" {
			return nil, fmt.Errorf("tournament %s is %s", a.tour.id, rt.Status)
		}
		if err := store.CompleteHand(ctx, tx, handID, board, resultHash, players); err != nil {
			return nil, err
		}
		for _, b := range busted {
			if err := store.DeleteSeat(ctx, tx, a.cfg.ID, b.user); err != nil {
				return nil, err
			}
		}
		if err := store.UpdateSeatStacks(ctx, tx, a.cfg.ID, remaining); err != nil {
			return nil, err
		}
		if err := store.VerifyTournamentChips(ctx, tx, a.tour.id, a.tour.totalChips); err != nil {
			return nil, err
		}
		if len(busts) == 0 {
			return nil, nil
		}

		alive, err := store.RemainingEntrants(ctx, tx, a.tour.id)
		if err != nil {
			return nil, err
		}
		places := tournament.EliminationPlaces(len(alive), busts)
		// Worst place first, so the log reads in elimination order.
		sort.Slice(busted, func(i, j int) bool { return places[busted[i].user] > places[busted[j].user] })
		var drafts []draft
		for _, b := range busted {
			place := places[b.user]
			if err := store.EliminateEntry(ctx, tx, a.tour.id, b.user, place, handID); err != nil {
				return nil, err
			}
			drafts = append(drafts, draft{kind: KindPlayerLeft, public: playerLeftPayload{
				Kind: KindPlayerLeft, Seat: b.seat, UserID: b.user, Reason: "ELIMINATED", Place: place,
			}})
		}
		a.tour.pending.eliminated = len(busts)
		if len(alive)-len(busts) != 1 {
			return drafts, nil
		}
		a.tour.pending.finished = true
		more, err := a.finishTournament(ctx, tx, next, rt, alive, places)
		if err != nil {
			return nil, err
		}
		return append(drafts, more...), nil
	}
}

// finishTournament awards first place to the last player, pays the prize
// pool out to the finishing places and marks the tournament finished.
func (a *Actor) finishTournament(ctx context.Context, tx pgx.Tx, next *poker.Table, rt store.TournamentRuntime, alive []string, places map[string]int) ([]draft, error) {
	var winner string
	for _, u := range alive {
		if _, out := places[u]; !out {
			winner = u
		}
	}
	if err := store.EliminateEntry(ctx, tx, a.tour.id, winner, 1, ""); err != nil {
		return nil, err
	}
	placed, err := store.Placements(ctx, tx, a.tour.id)
	if err != nil {
		return nil, err
	}
	placements := make([]tournament.Placement, len(placed))
	for i, p := range placed {
		placements[i] = tournament.Placement{Player: p.UserID, Place: p.Place}
	}
	awards := tournament.Award(tournament.Prizes(rt.Entrants, rt.PrizePool), placements)
	users := make([]string, 0, len(awards))
	for u := range awards {
		users = append(users, u)
	}
	sort.Strings(users)
	pool, err := ledger.EnsureAccount(ctx, tx, a.tour.clubID, ledger.AccountTournamentPool, a.tour.id, "")
	if err != nil {
		return nil, err
	}
	var paid int64
	entries := []ledger.Entry{}
	for _, u := range users {
		prize := awards[u]
		if prize == 0 {
			continue
		}
		if err := store.SetEntryPrize(ctx, tx, a.tour.id, u, prize); err != nil {
			return nil, err
		}
		wallet, err := ledger.EnsureAccount(ctx, tx, a.tour.clubID, ledger.AccountMemberWallet, u, "")
		if err != nil {
			return nil, err
		}
		entries = append(entries, ledger.Entry{AccountID: wallet, Amount: prize, Reason: "TOURNAMENT_PRIZE"})
		paid += prize
	}
	if paid != rt.PrizePool {
		return nil, fmt.Errorf("tournament %s: awards %d != prize pool %d", a.tour.id, paid, rt.PrizePool)
	}
	if paid > 0 {
		entries = append(entries, ledger.Entry{AccountID: pool, Amount: -paid, Reason: "TOURNAMENT_PRIZE"})
		res, err := ledger.Post(ctx, tx, ledger.Posting{
			ExternalRef: "tournament-payout:" + a.tour.id, Kind: ledger.KindTournamentPayout, ClubID: a.tour.clubID,
			ReferenceType: "tournament", ReferenceID: a.tour.id,
			Metadata: map[string]any{"entrants": rt.Entrants, "prizePool": rt.PrizePool},
			Entries:  entries,
		})
		if err != nil {
			return nil, err
		}
		if !res.Created {
			return nil, fmt.Errorf("tournament %s was already paid out", a.tour.id)
		}
	}
	if err := store.FinishRuntime(ctx, tx, a.tour.id); err != nil {
		return nil, err
	}
	var drafts []draft
	if seat := next.SeatOf(poker.PlayerID(winner)); seat != 0 {
		if _, err := next.StandUp(seat); err != nil {
			return nil, fromEngine(err)
		}
		if err := store.DeleteSeat(ctx, tx, a.cfg.ID, winner); err != nil {
			return nil, err
		}
		drafts = append(drafts, draft{kind: KindPlayerLeft, public: playerLeftPayload{
			Kind: KindPlayerLeft, Seat: seat, UserID: winner, Reason: "FINISHED", Place: 1,
		}})
	}
	a.log.Info("tournament_finished", slog.String("tournament_id", a.tour.id), slog.Int("entrants", rt.Entrants), slog.Int64("prize_pool", rt.PrizePool))
	return drafts, nil
}
