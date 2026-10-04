package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Tournament is a tournament's configuration (written by the control-api
// directory) together with its runtime state (written here, ADR-016).
type Tournament struct {
	ID            string
	ClubID        string
	Name          string
	GameType      string
	BuyIn         int64
	StartingStack int64
	SmallBlind    int64
	BigBlind      int64
	LevelDuration time.Duration
	SeatsPerTable int
	MinPlayers    int
	MaxPlayers    int
	StartMode     string
	StartsAt      *time.Time
	// Status is the directory status (REGISTERING | CANCELLED).
	Status         string
	StartRequested bool
	Runtime        *TournamentRuntime
}

// TournamentRuntime is the game service's state of a started tournament.
type TournamentRuntime struct {
	Status     string // RUNNING | FINISHED | CANCELLED
	Entrants   int
	PrizePool  int64
	TotalChips int64
	StartedAt  time.Time
	FinishedAt *time.Time
}

// Querier is satisfied by the pool and by transactions.
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

const tournamentSelect = `
	SELECT t.id::text, t.club_id::text, t.name, t.game_type, t.buy_in, t.starting_stack, t.small_blind, t.big_blind,
	       t.level_duration_sec, t.seats_per_table, t.min_players, t.max_players, t.start_mode, t.starts_at,
	       t.status, t.start_requested_at IS NOT NULL,
	       r.status, r.entrants, r.prize_pool, r.total_chips, r.started_at, r.finished_at
	  FROM tournaments t LEFT JOIN tournament_runtime r ON r.tournament_id = t.id
	 WHERE t.id = $1`

// LoadTournament reads a tournament. With lock set (inside a transaction)
// the directory row is locked FOR UPDATE, serializing the start decision
// with registrations and cancellations.
func LoadTournament(ctx context.Context, q Querier, id string, lock bool) (Tournament, error) {
	sql := tournamentSelect
	if lock {
		sql += ` FOR UPDATE OF t`
	}
	var t Tournament
	var levelSec int
	var rtStatus *string
	var entrants *int
	var pool, chips *int64
	var started *time.Time
	var finished *time.Time
	err := q.QueryRow(ctx, sql, id).Scan(&t.ID, &t.ClubID, &t.Name, &t.GameType, &t.BuyIn, &t.StartingStack, &t.SmallBlind,
		&t.BigBlind, &levelSec, &t.SeatsPerTable, &t.MinPlayers, &t.MaxPlayers, &t.StartMode, &t.StartsAt, &t.Status,
		&t.StartRequested, &rtStatus, &entrants, &pool, &chips, &started, &finished)
	if errors.Is(err, pgx.ErrNoRows) {
		return t, ErrNotFound
	}
	if err != nil {
		return t, err
	}
	t.LevelDuration = time.Duration(levelSec) * time.Second
	if rtStatus != nil {
		t.Runtime = &TournamentRuntime{Status: *rtStatus, Entrants: *entrants, PrizePool: *pool, TotalChips: *chips, StartedAt: *started, FinishedAt: finished}
	}
	return t, nil
}

// DueTournaments lists registering tournaments whose start condition may
// be met: a full sit-and-go, a scheduled start time that passed, or a start
// requested by club staff.
func (s *Store) DueTournaments(ctx context.Context, limit int) ([]string, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT t.id::text FROM tournaments t
		 WHERE t.status = 'REGISTERING'
		   AND NOT EXISTS (SELECT 1 FROM tournament_runtime r WHERE r.tournament_id = t.id)
		   AND (t.start_requested_at IS NOT NULL
		        OR (t.start_mode = 'SCHEDULED' AND t.starts_at <= now())
		        OR (t.start_mode = 'SIT_AND_GO' AND (SELECT count(*) FROM tournament_registrations g
		                                             WHERE g.tournament_id = t.id AND g.status = 'ACTIVE') >= t.max_players))
		 ORDER BY t.created_at LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// Registration is an active tournament registration.
type Registration struct {
	ID     string
	UserID string
	BuyIn  int64
}

// ActiveRegistrations lists a tournament's active registrations.
func ActiveRegistrations(ctx context.Context, q Querier, tournamentID string) ([]Registration, error) {
	rows, err := q.Query(ctx, `
		SELECT id::text, user_id::text, buy_in FROM tournament_registrations
		 WHERE tournament_id = $1 AND status = 'ACTIVE' ORDER BY created_at, id`, tournamentID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Registration, error) {
		var g Registration
		err := r.Scan(&g.ID, &g.UserID, &g.BuyIn)
		return g, err
	})
}

// TournamentTable is one of a tournament's tables with its population:
// seated players and pending inbound transfers.
type TournamentTable struct {
	ID       string
	No       int
	MaxSeats int
	Seated   int
	Inbound  int
}

// TournamentTables lists a tournament's tables in table-number order.
func TournamentTables(ctx context.Context, q Querier, tournamentID string) ([]TournamentTable, error) {
	rows, err := q.Query(ctx, `
		SELECT t.id::text, t.tournament_table_no, t.max_seats,
		       (SELECT count(*) FROM table_seats s WHERE s.table_id = t.id)::int,
		       (SELECT count(*) FROM tournament_transfers x WHERE x.to_table_id = t.id)::int
		  FROM tables t WHERE t.tournament_id = $1 ORDER BY t.tournament_table_no`, tournamentID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (TournamentTable, error) {
		var t TournamentTable
		err := r.Scan(&t.ID, &t.No, &t.MaxSeats, &t.Seated, &t.Inbound)
		return t, err
	})
}

// InsertRuntime records a tournament's start (or cancellation at start).
func InsertRuntime(ctx context.Context, tx pgx.Tx, tournamentID string, rt TournamentRuntime) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO tournament_runtime (tournament_id, status, entrants, prize_pool, total_chips, started_at, finished_at)
		VALUES ($1, $2, $3, $4, $5, now(), CASE WHEN $2 = 'RUNNING' THEN NULL ELSE now() END)`,
		tournamentID, rt.Status, rt.Entrants, rt.PrizePool, rt.TotalChips)
	return err
}

// InsertEntry records an entrant seated at the start.
func InsertEntry(ctx context.Context, tx pgx.Tx, tournamentID, userID, registrationID, tableID string) error {
	_, err := tx.Exec(ctx, `INSERT INTO tournament_entries (tournament_id, user_id, registration_id, table_id) VALUES ($1, $2, $3, $4)`,
		tournamentID, userID, registrationID, tableID)
	return err
}

// LockRuntime locks the runtime row (serializing eliminations, balancing
// and the finish across the tournament's tables) and returns it.
func LockRuntime(ctx context.Context, tx pgx.Tx, tournamentID string) (TournamentRuntime, error) {
	var rt TournamentRuntime
	err := tx.QueryRow(ctx, `
		SELECT status, entrants, prize_pool, total_chips, started_at, finished_at
		  FROM tournament_runtime WHERE tournament_id = $1 FOR UPDATE`, tournamentID).
		Scan(&rt.Status, &rt.Entrants, &rt.PrizePool, &rt.TotalChips, &rt.StartedAt, &rt.FinishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return rt, ErrNotFound
	}
	return rt, err
}

// RemainingEntrants counts players not yet eliminated.
func RemainingEntrants(ctx context.Context, tx pgx.Tx, tournamentID string) ([]string, error) {
	rows, err := tx.Query(ctx, `SELECT user_id::text FROM tournament_entries WHERE tournament_id = $1 AND place IS NULL ORDER BY user_id`, tournamentID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// EliminateEntry records a finishing place.
func EliminateEntry(ctx context.Context, tx pgx.Tx, tournamentID, userID string, place int, handID string) error {
	tag, err := tx.Exec(ctx, `
		UPDATE tournament_entries SET place = $3, eliminated_at = now(), eliminated_hand_id = $4, table_id = NULL
		 WHERE tournament_id = $1 AND user_id = $2 AND place IS NULL`, tournamentID, userID, place, nullable(handID))
	if err == nil && tag.RowsAffected() != 1 {
		return fmt.Errorf("store: entry %s is not in the tournament", userID)
	}
	return err
}

// Placement is a recorded finishing place.
type Placement struct {
	UserID string
	Place  int
}

// Placements lists every entrant's place (finished tournaments).
func Placements(ctx context.Context, tx pgx.Tx, tournamentID string) ([]Placement, error) {
	rows, err := tx.Query(ctx, `SELECT user_id::text, place FROM tournament_entries WHERE tournament_id = $1 AND place IS NOT NULL`, tournamentID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Placement, error) {
		var p Placement
		err := r.Scan(&p.UserID, &p.Place)
		return p, err
	})
}

// EntryPlace returns a player's finishing place (0 while still playing).
func EntryPlace(ctx context.Context, q Querier, tournamentID, userID string) (int, error) {
	var place *int
	err := q.QueryRow(ctx, `SELECT place FROM tournament_entries WHERE tournament_id = $1 AND user_id = $2`, tournamentID, userID).Scan(&place)
	if err != nil || place == nil {
		return 0, err
	}
	return *place, nil
}

// SetEntryPrize stores a player's prize.
func SetEntryPrize(ctx context.Context, tx pgx.Tx, tournamentID, userID string, prize int64) error {
	_, err := tx.Exec(ctx, `UPDATE tournament_entries SET prize = $3 WHERE tournament_id = $1 AND user_id = $2`, tournamentID, userID, prize)
	return err
}

// FinishRuntime marks the tournament finished and drops transfers.
func FinishRuntime(ctx context.Context, tx pgx.Tx, tournamentID string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM tournament_transfers WHERE tournament_id = $1`, tournamentID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE tournament_runtime SET status = 'FINISHED', finished_at = now() WHERE tournament_id = $1 AND status = 'RUNNING'`, tournamentID)
	return err
}

// SetEntryTable updates a player's current (or destination) table.
func SetEntryTable(ctx context.Context, tx pgx.Tx, tournamentID, userID, tableID string) error {
	_, err := tx.Exec(ctx, `UPDATE tournament_entries SET table_id = $3 WHERE tournament_id = $1 AND user_id = $2`, tournamentID, userID, tableID)
	return err
}

// Transfer is a player moving between tournament tables.
type Transfer struct {
	UserID      string
	Username    string
	FromTableID string
	ToTableID   string
	SeatNo      int
	Stack       int64
	SittingOut  bool
}

// InsertTransfer records a player leaving for another table.
func InsertTransfer(ctx context.Context, tx pgx.Tx, tournamentID string, t Transfer) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO tournament_transfers (tournament_id, user_id, from_table_id, to_table_id, seat_no, stack, sitting_out)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, tournamentID, t.UserID, t.FromTableID, t.ToTableID, t.SeatNo, t.Stack, t.SittingOut)
	return err
}

// InboundTransfers lists (and with lock, locks) transfers to a table.
func InboundTransfers(ctx context.Context, q Querier, toTableID string, lock bool) ([]Transfer, error) {
	sql := `SELECT x.user_id::text, u.username, x.from_table_id::text, x.to_table_id::text, x.seat_no, x.stack, x.sitting_out
	          FROM tournament_transfers x JOIN users u ON u.id = x.user_id
	         WHERE x.to_table_id = $1 ORDER BY x.created_at, x.user_id`
	if lock {
		sql += ` FOR UPDATE OF x`
	}
	rows, err := q.Query(ctx, sql, toTableID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Transfer, error) {
		var t Transfer
		err := r.Scan(&t.UserID, &t.Username, &t.FromTableID, &t.ToTableID, &t.SeatNo, &t.Stack, &t.SittingOut)
		return t, err
	})
}

// RedirectTransfer sends a pending transfer to another table and seat.
func RedirectTransfer(ctx context.Context, tx pgx.Tx, tournamentID, userID, toTableID string, seatNo int) error {
	_, err := tx.Exec(ctx, `UPDATE tournament_transfers SET to_table_id = $3, seat_no = $4 WHERE tournament_id = $1 AND user_id = $2`,
		tournamentID, userID, toTableID, seatNo)
	return err
}

// DeleteTransfer removes a claimed transfer.
func DeleteTransfer(ctx context.Context, tx pgx.Tx, tournamentID, userID string) error {
	_, err := tx.Exec(ctx, `DELETE FROM tournament_transfers WHERE tournament_id = $1 AND user_id = $2`, tournamentID, userID)
	return err
}

// TakenSeats lists seat numbers that are occupied or reserved by a pending
// transfer at a table.
func TakenSeats(ctx context.Context, tx pgx.Tx, tableID string) (map[int]bool, error) {
	rows, err := tx.Query(ctx, `
		SELECT seat_no FROM table_seats WHERE table_id = $1
		UNION SELECT seat_no FROM tournament_transfers WHERE to_table_id = $1`, tableID)
	if err != nil {
		return nil, err
	}
	seats, err := pgx.CollectRows(rows, pgx.RowTo[int])
	out := map[int]bool{}
	for _, s := range seats {
		out[s] = true
	}
	return out, err
}

// InsertSeatState seats a player with a sitting-out flag (tournament moves).
func InsertSeatState(ctx context.Context, tx pgx.Tx, tableID string, seatNo int, userID string, stack int64, sittingOut bool) error {
	_, err := tx.Exec(ctx, `INSERT INTO table_seats (table_id, seat_no, user_id, stack_cached, sitting_out) VALUES ($1, $2, $3, $4, $5)`,
		tableID, seatNo, userID, stack, sittingOut)
	if isUniqueViolation(err) {
		return fmt.Errorf("%w: seat %d", ErrDuplicate, seatNo)
	}
	return err
}

// VerifyTournamentChips asserts that the chips at the tournament's tables
// (seat stacks at hand boundaries) plus the chips in transit equal the
// chips put in play at the start. A mismatch aborts the transaction.
func VerifyTournamentChips(ctx context.Context, tx pgx.Tx, tournamentID string, total int64) error {
	var seated, transit int64
	err := tx.QueryRow(ctx, `
		SELECT coalesce((SELECT sum(s.stack_cached) FROM table_seats s JOIN tables t ON t.id = s.table_id WHERE t.tournament_id = $1), 0)::bigint,
		       coalesce((SELECT sum(stack) FROM tournament_transfers WHERE tournament_id = $1), 0)::bigint`, tournamentID).
		Scan(&seated, &transit)
	if err != nil {
		return err
	}
	if seated+transit != total {
		return fmt.Errorf("store: tournament %s chips %d seated + %d moving != %d in play", tournamentID, seated, transit, total)
	}
	return nil
}

// TournamentTick is the cheap per-table poll: pending arrivals and the
// tournament's runtime status.
func (s *Store) TournamentTick(ctx context.Context, tournamentID, tableID string) (inbound int, status string, err error) {
	err = s.Pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM tournament_transfers WHERE to_table_id = $2)::int,
		       coalesce((SELECT status FROM tournament_runtime WHERE tournament_id = $1), '')`, tournamentID, tableID).
		Scan(&inbound, &status)
	return inbound, status, err
}
