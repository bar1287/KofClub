// Package tournaments starts tournaments (M10, ADR-016). Each game-service
// node polls for registering tournaments whose start condition is met and
// starts them in one transaction that locks the directory row: the
// registrations become entries, the prize pool is checked against the
// ledger and the players are seated at the tournament's tables. Starting is
// idempotent across nodes (the lock plus the runtime row decide who wins).
// A scheduled tournament that is still short of players at its start time
// is cancelled and every buy-in refunded instead.
package tournaments

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/apps/game-service/internal/table"
	ledger "github.com/bar1287/kofclub/go/ledger-client"
	"github.com/bar1287/kofclub/go/tournament"
)

// Outcome of a start attempt.
type Outcome string

// Outcomes.
const (
	NotDue    Outcome = ""
	Started   Outcome = "STARTED"
	Cancelled Outcome = "CANCELLED"
)

// Scheduler starts due tournaments.
type Scheduler struct {
	store    *store.Store
	rand     io.Reader
	activate func(ctx context.Context, tableID string) error
	log      *slog.Logger
	metrics  *table.Metrics
	interval time.Duration
}

// New creates a scheduler. activate starts a table's actor (the registry).
func New(s *store.Store, rng io.Reader, activate func(ctx context.Context, tableID string) error, log *slog.Logger,
	metrics *table.Metrics, interval time.Duration) *Scheduler {
	return &Scheduler{store: s, rand: rng, activate: activate, log: log.With(slog.String("component", "tournaments")),
		metrics: metrics, interval: interval}
}

// Run polls until ctx ends.
func (s *Scheduler) Run(ctx context.Context) {
	t := time.NewTicker(s.interval)
	defer t.Stop()
	for {
		s.Tick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// Tick starts every tournament that is due now.
func (s *Scheduler) Tick(ctx context.Context) {
	ids, err := s.store.DueTournaments(ctx, 20)
	if err != nil {
		if ctx.Err() == nil {
			s.log.Warn("tournament_scan_failed", slog.String("error", err.Error()))
		}
		return
	}
	for _, id := range ids {
		if _, err := s.Start(ctx, id); err != nil && ctx.Err() == nil {
			s.metrics.TournamentFailures.WithLabelValues("start").Inc()
			s.log.Error("tournament_start_failed", slog.String("tournament_id", id), slog.String("error", err.Error()))
		}
	}
}

// Start starts (or cancels) one tournament if it is due.
func (s *Scheduler) Start(ctx context.Context, id string) (Outcome, error) {
	var outcome Outcome
	var tables []string
	err := pgx.BeginTxFunc(ctx, s.store.Pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		outcome, tables = NotDue, nil
		t, err := store.LoadTournament(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if t.Status != "REGISTERING" || t.Runtime != nil {
			return nil
		}
		regs, err := store.ActiveRegistrations(ctx, tx, id)
		if err != nil {
			return err
		}
		scheduledDue := t.StartMode == "SCHEDULED" && t.StartsAt != nil && !t.StartsAt.After(time.Now())
		full := len(regs) >= t.MaxPlayers
		enough := len(regs) >= t.MinPlayers
		switch {
		case enough && (full || scheduledDue || t.StartRequested):
			tables, err = s.seat(ctx, tx, t, regs)
			outcome = Started
			return err
		case scheduledDue:
			outcome = Cancelled
			return s.cancel(ctx, tx, t, regs)
		default:
			return nil // e.g. a start request while players unregistered
		}
	})
	if err != nil {
		return NotDue, err
	}
	switch outcome {
	case Started:
		s.metrics.TournamentsStarted.Inc()
		s.log.Info("tournament_started", slog.String("tournament_id", id), slog.Int("tables", len(tables)))
		for _, tableID := range tables {
			if err := s.activate(ctx, tableID); err != nil {
				// The orphan scan adopts it shortly; seats are durable.
				s.log.Warn("tournament_table_activation_failed", slog.String("table_id", tableID), slog.String("error", err.Error()))
			}
		}
	case Cancelled:
		s.metrics.TournamentsCancelled.Inc()
		s.log.Info("tournament_cancelled_short_of_players", slog.String("tournament_id", id))
	}
	return outcome, nil
}

func (s *Scheduler) seat(ctx context.Context, tx pgx.Tx, t store.Tournament, regs []store.Registration) ([]string, error) {
	pool, err := ledger.EnsureAccount(ctx, tx, t.ClubID, ledger.AccountTournamentPool, t.ID, "")
	if err != nil {
		return nil, err
	}
	balance, err := ledger.Balance(ctx, tx, pool)
	if err != nil {
		return nil, err
	}
	var buyIns int64
	for _, r := range regs {
		buyIns += r.BuyIn
	}
	if balance != buyIns {
		return nil, fmt.Errorf("prize pool holds %d but registrations paid %d", balance, buyIns)
	}

	order := make([]int, len(regs))
	for i := range order {
		order[i] = i
	}
	if err := shuffle(s.rand, order); err != nil {
		return nil, err
	}
	players := make([]string, len(regs))
	byUser := map[string]store.Registration{}
	for i, k := range order {
		players[i] = regs[k].UserID
		byUser[regs[k].UserID] = regs[k]
	}
	tables, err := store.TournamentTables(ctx, tx, t.ID)
	if err != nil {
		return nil, err
	}
	slots := make([]tournament.TableSlot, len(tables))
	for i, tb := range tables {
		slots[i] = tournament.TableSlot{ID: tb.ID, No: tb.No, MaxSeats: tb.MaxSeats}
	}
	seating, err := tournament.InitialSeating(players, slots)
	if err != nil {
		return nil, err
	}
	if err := store.InsertRuntime(ctx, tx, t.ID, store.TournamentRuntime{
		Status: "RUNNING", Entrants: len(regs), PrizePool: balance, TotalChips: int64(len(regs)) * t.StartingStack,
	}); err != nil {
		return nil, err
	}
	used := map[string]bool{}
	var tableIDs []string
	for _, a := range seating {
		if err := store.InsertEntry(ctx, tx, t.ID, a.Player, byUser[a.Player].ID, a.TableID); err != nil {
			return nil, err
		}
		if err := store.InsertSeat(ctx, tx, a.TableID, a.Seat, a.Player, t.StartingStack); err != nil {
			return nil, err
		}
		if !used[a.TableID] {
			used[a.TableID] = true
			tableIDs = append(tableIDs, a.TableID)
		}
	}
	return tableIDs, nil
}

func (s *Scheduler) cancel(ctx context.Context, tx pgx.Tx, t store.Tournament, regs []store.Registration) error {
	pool, err := ledger.EnsureAccount(ctx, tx, t.ClubID, ledger.AccountTournamentPool, t.ID, "")
	if err != nil {
		return err
	}
	for _, r := range regs {
		if r.BuyIn == 0 {
			continue
		}
		wallet, err := ledger.EnsureAccount(ctx, tx, t.ClubID, ledger.AccountMemberWallet, r.UserID, "")
		if err != nil {
			return err
		}
		// Same reference as a refund by the control plane: never twice.
		if _, err := ledger.Post(ctx, tx, ledger.Posting{
			ExternalRef: "tournament-refund:" + r.ID, Kind: ledger.KindTournamentRefund, ClubID: t.ClubID,
			ReferenceType: "tournament", ReferenceID: t.ID, Metadata: map[string]any{"reason": "NOT_ENOUGH_PLAYERS"},
			Entries: []ledger.Entry{{AccountID: pool, Amount: -r.BuyIn, Reason: "TOURNAMENT_REFUND"}, {AccountID: wallet, Amount: r.BuyIn, Reason: "TOURNAMENT_REFUND"}},
		}); err != nil {
			return err
		}
	}
	return store.InsertRuntime(ctx, tx, t.ID, store.TournamentRuntime{Status: "CANCELLED"})
}

// shuffle permutes s uniformly (Fisher–Yates) using r, a cryptographic
// source in production; seat draws are as unpredictable as decks.
func shuffle(r io.Reader, s []int) error {
	for i := len(s) - 1; i > 0; i-- {
		j, err := uniform(r, uint64(i+1))
		if err != nil {
			return err
		}
		s[i], s[j] = s[j], s[i]
	}
	return nil
}

// uniform returns an unbiased integer in [0, n) by rejection sampling.
func uniform(r io.Reader, n uint64) (int, error) {
	if n == 0 {
		return 0, errors.New("tournaments: empty range")
	}
	limit := ^uint64(0) - (^uint64(0) % n)
	var b [8]byte
	for {
		if _, err := io.ReadFull(r, b[:]); err != nil {
			return 0, err
		}
		if v := binary.LittleEndian.Uint64(b[:]); v < limit {
			return int(v % n), nil
		}
	}
}
