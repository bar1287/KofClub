// Package store is the game service's PostgreSQL persistence. Every write
// happens inside a fenced transaction: the table lease row is locked and
// its (owner, epoch) verified first, so a node that lost ownership can never
// write (ADR-002).
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Errors.
var (
	ErrNotFound  = errors.New("store: not found")
	ErrFenced    = errors.New("store: table lease lost (fenced)")
	ErrDuplicate = errors.New("store: duplicate")
)

// Store wraps the connection pool.
type Store struct {
	Pool   *pgxpool.Pool
	NodeID string
}

// New returns a Store for nodeID.
func New(pool *pgxpool.Pool, nodeID string) *Store { return &Store{Pool: pool, NodeID: nodeID} }

// TableConfig is the table directory row.
type TableConfig struct {
	ID            string
	ClubID        string
	Name          string
	MaxSeats      int
	SmallBlind    int64
	BigBlind      int64
	BuyInMin      int64
	BuyInMax      int64
	ActionTimeout time.Duration
	Status        string
}

// LoadTable reads a table's configuration.
func (s *Store) LoadTable(ctx context.Context, tableID string) (TableConfig, error) {
	var c TableConfig
	var timeoutMs int
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, club_id::text, name, max_seats, small_blind, big_blind, buyin_min, buyin_max, action_timeout_ms, status
		  FROM tables WHERE id = $1`, tableID).
		Scan(&c.ID, &c.ClubID, &c.Name, &c.MaxSeats, &c.SmallBlind, &c.BigBlind, &c.BuyInMin, &c.BuyInMax, &timeoutMs, &c.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	c.ActionTimeout = time.Duration(timeoutMs) * time.Millisecond
	return c, err
}

// Runtime is durable table-level state.
type Runtime struct {
	LastHandNo int64
	ButtonSeat int
	LastSeq    int64
}

// LoadRuntime returns the runtime row (zero value when absent).
func (s *Store) LoadRuntime(ctx context.Context, tableID string) (Runtime, error) {
	var r Runtime
	err := s.Pool.QueryRow(ctx, `SELECT last_hand_no, button_seat, last_seq FROM table_runtime WHERE table_id = $1`, tableID).
		Scan(&r.LastHandNo, &r.ButtonSeat, &r.LastSeq)
	if errors.Is(err, pgx.ErrNoRows) {
		return Runtime{}, nil
	}
	return r, err
}

// Seat is a persisted seat.
type Seat struct {
	SeatNo     int
	UserID     string
	Username   string
	Stack      int64
	SittingOut bool
}

// LoadSeats returns the seats of a table ordered by seat number.
func (s *Store) LoadSeats(ctx context.Context, tableID string) ([]Seat, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT s.seat_no, s.user_id::text, u.username, s.stack_cached, s.sitting_out
		  FROM table_seats s JOIN users u ON u.id = s.user_id
		 WHERE s.table_id = $1 ORDER BY s.seat_no`, tableID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Seat, error) {
		var st Seat
		err := r.Scan(&st.SeatNo, &st.UserID, &st.Username, &st.Stack, &st.SittingOut)
		return st, err
	})
}

// HandPlayerRecord is a persisted hand participant.
type HandPlayerRecord struct {
	UserID        string
	SeatNo        int
	StartingStack int64
	HoleCardsEnc  []byte
}

// HandRecord is a persisted in-progress hand with its accepted actions.
type HandRecord struct {
	ID         string
	HandNo     int64
	ButtonSeat int
	SmallBlind int64
	BigBlind   int64
	DeckEnc    []byte
	Players    []HandPlayerRecord
	// Actions are the PLAYER_ACTED payloads in seq order.
	Actions []json.RawMessage
}

// LoadInProgressHand returns the unfinished hand of a table, if any.
func (s *Store) LoadInProgressHand(ctx context.Context, tableID string) (*HandRecord, error) {
	var h HandRecord
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, hand_no, button_seat, small_blind, big_blind, deck_enc
		  FROM hands WHERE table_id = $1 AND status = 'IN_PROGRESS'`, tableID).
		Scan(&h.ID, &h.HandNo, &h.ButtonSeat, &h.SmallBlind, &h.BigBlind, &h.DeckEnc)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT user_id::text, seat_no, starting_stack, hole_cards_enc FROM hand_players
		 WHERE hand_id = $1 ORDER BY seat_no`, h.ID)
	if err != nil {
		return nil, err
	}
	h.Players, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (HandPlayerRecord, error) {
		var p HandPlayerRecord
		err := r.Scan(&p.UserID, &p.SeatNo, &p.StartingStack, &p.HoleCardsEnc)
		return p, err
	})
	if err != nil {
		return nil, err
	}
	rows, err = s.Pool.Query(ctx, `
		SELECT payload_json FROM game_events
		 WHERE table_id = $1 AND hand_id = $2 AND event_type = 'PLAYER_ACTED' ORDER BY seq`, tableID, h.ID)
	if err != nil {
		return nil, err
	}
	h.Actions, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (json.RawMessage, error) {
		var p json.RawMessage
		err := r.Scan(&p)
		return p, err
	})
	return &h, err
}

// ProcessedCommand is an accepted command loaded for idempotency.
type ProcessedCommand struct {
	CommandID string
	UserID    string
	Seq       int64
}

// LoadRecentCommands returns the most recent accepted commands of a table.
func (s *Store) LoadRecentCommands(ctx context.Context, tableID string, limit int) ([]ProcessedCommand, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT command_id::text, user_id::text, seq FROM table_commands
		 WHERE table_id = $1 ORDER BY seq DESC LIMIT $2`, tableID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ProcessedCommand, error) {
		var c ProcessedCommand
		err := r.Scan(&c.CommandID, &c.UserID, &c.Seq)
		return c, err
	})
}

// Username returns a user's username.
func (s *Store) Username(ctx context.Context, userID string) (string, error) {
	var name string
	err := s.Pool.QueryRow(ctx, `SELECT username FROM users WHERE id = $1`, userID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return name, err
}

// LedgerTxExists reports whether a ledger transaction with external_ref exists.
func (s *Store) LedgerTxExists(ctx context.Context, externalRef string) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ledger_transactions WHERE external_ref = $1)`, externalRef).Scan(&ok)
	return ok, err
}

// OrphanedTables lists open tables that have seated players or an
// unfinished hand but no live lease (their owner died or released them).
func (s *Store) OrphanedTables(ctx context.Context, limit int) ([]string, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT t.id::text FROM tables t
		  LEFT JOIN table_leases l ON l.table_id = t.id
		 WHERE (l.table_id IS NULL OR l.expires_at < now())
		   AND (EXISTS (SELECT 1 FROM table_seats s WHERE s.table_id = t.id)
		        OR EXISTS (SELECT 1 FROM hands h WHERE h.table_id = t.id AND h.status = 'IN_PROGRESS'))
		 LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// Fence identifies the lease a write must hold.
type Fence struct {
	TableID string
	NodeID  string
	Epoch   int64
}

// InFencedTx runs fn in a transaction that first verifies the caller still
// owns the table lease. The lease row stays share-locked until commit, so a
// takeover cannot interleave with the write.
func (s *Store) InFencedTx(ctx context.Context, f Fence, fn func(tx pgx.Tx) error) error {
	return pgx.BeginTxFunc(ctx, s.Pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		var owner string
		var epoch int64
		err := tx.QueryRow(ctx, `SELECT owner_node_id, epoch FROM table_leases WHERE table_id = $1 FOR SHARE`, f.TableID).
			Scan(&owner, &epoch)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrFenced
		}
		if err != nil {
			return err
		}
		if owner != f.NodeID || epoch != f.Epoch {
			return fmt.Errorf("%w: lease held by %s epoch %d", ErrFenced, owner, epoch)
		}
		return fn(tx)
	})
}

// SealedHoleCards returns a participant's encrypted hole cards and the
// hand's status (ErrNotFound when the user was not dealt into the hand).
func (s *Store) SealedHoleCards(ctx context.Context, handID, userID string) ([]byte, string, error) {
	var enc []byte
	var status string
	err := s.Pool.QueryRow(ctx, `
		SELECT hp.hole_cards_enc, h.status
		  FROM hand_players hp JOIN hands h ON h.id = hp.hand_id
		 WHERE hp.hand_id = $1 AND hp.user_id = $2`, handID, userID).Scan(&enc, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	return enc, status, err
}

// TableStatus reads the table's directory status (OPEN | CLOSED).
func (s *Store) TableStatus(ctx context.Context, tableID string) (string, error) {
	var status string
	err := s.Pool.QueryRow(ctx, `SELECT status FROM tables WHERE id = $1`, tableID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return status, err
}
