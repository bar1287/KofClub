package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// PersistedEvent is a public table event to append to game_events.
type PersistedEvent struct {
	Seq     int64
	HandID  string // empty for table-level events
	EventID string
	Type    string
	Payload json.RawMessage
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// InsertEvents appends events with a single batch.
func InsertEvents(ctx context.Context, tx pgx.Tx, tableID string, events []PersistedEvent) error {
	if len(events) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, e := range events {
		batch.Queue(`INSERT INTO game_events (table_id, seq, hand_id, event_id, event_type, payload_json)
		             VALUES ($1, $2, $3, $4, $5, $6)`,
			tableID, e.Seq, nullable(e.HandID), e.EventID, e.Type, e.Payload)
	}
	return tx.SendBatch(ctx, batch).Close()
}

// InsertCommand records an accepted command id (idempotency across restarts).
func InsertCommand(ctx context.Context, tx pgx.Tx, tableID, commandID, userID, handID, kind string, amount int64, seq int64) error {
	_, err := tx.Exec(ctx, `INSERT INTO table_commands (table_id, command_id, user_id, hand_id, kind, amount, seq)
	                        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		tableID, commandID, userID, nullable(handID), kind, amount, seq)
	if isUniqueViolation(err) {
		return fmt.Errorf("%w: command %s", ErrDuplicate, commandID)
	}
	return err
}

// UpsertRuntime stores table-level state.
func UpsertRuntime(ctx context.Context, tx pgx.Tx, tableID string, r Runtime) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO table_runtime (table_id, last_hand_no, button_seat, last_seq) VALUES ($1, $2, $3, $4)
		ON CONFLICT (table_id) DO UPDATE
		   SET last_hand_no = EXCLUDED.last_hand_no, button_seat = EXCLUDED.button_seat,
		       last_seq = EXCLUDED.last_seq, updated_at = now()`,
		tableID, r.LastHandNo, r.ButtonSeat, r.LastSeq)
	return err
}

// InsertSeat seats a player with the table's full time bank.
func InsertSeat(ctx context.Context, tx pgx.Tx, tableID string, seatNo int, userID string, stack int64) error {
	_, err := tx.Exec(ctx, `INSERT INTO table_seats (table_id, seat_no, user_id, stack_cached, time_bank_ms)
	                        VALUES ($1, $2, $3, $4, (SELECT time_bank_ms FROM tables WHERE id = $1))`,
		tableID, seatNo, userID, stack)
	if isUniqueViolation(err) {
		return fmt.Errorf("%w: seat %d", ErrDuplicate, seatNo)
	}
	return err
}

// DeleteSeat removes a player's seat.
func DeleteSeat(ctx context.Context, tx pgx.Tx, tableID, userID string) error {
	_, err := tx.Exec(ctx, `DELETE FROM table_seats WHERE table_id = $1 AND user_id = $2`, tableID, userID)
	return err
}

// SetSittingOut updates a seat's sitting-out flag.
func SetSittingOut(ctx context.Context, tx pgx.Tx, tableID, userID string, out bool) error {
	_, err := tx.Exec(ctx, `UPDATE table_seats SET sitting_out = $3, updated_at = now() WHERE table_id = $1 AND user_id = $2`,
		tableID, userID, out)
	return err
}

// UpdateSeatStacks stores stack projections for the given users.
func UpdateSeatStacks(ctx context.Context, tx pgx.Tx, tableID string, stacks map[string]int64) error {
	batch := &pgx.Batch{}
	for userID, stack := range stacks {
		batch.Queue(`UPDATE table_seats SET stack_cached = $3, updated_at = now() WHERE table_id = $1 AND user_id = $2`,
			tableID, userID, stack)
	}
	return tx.SendBatch(ctx, batch).Close()
}

// SetAutoTopUp stores a seat's automatic top-up target (0 = off).
func SetAutoTopUp(ctx context.Context, tx pgx.Tx, tableID, userID string, to int64) error {
	_, err := tx.Exec(ctx, `UPDATE table_seats SET auto_top_up_to = $3, updated_at = now() WHERE table_id = $1 AND user_id = $2`,
		tableID, userID, to)
	return err
}

// UpdateSeatTimeBanks stores the remaining time bank of the given users.
func UpdateSeatTimeBanks(ctx context.Context, tx pgx.Tx, tableID string, banks map[string]time.Duration) error {
	batch := &pgx.Batch{}
	for userID, bank := range banks {
		batch.Queue(`UPDATE table_seats SET time_bank_ms = $3, updated_at = now() WHERE table_id = $1 AND user_id = $2`,
			tableID, userID, bank.Milliseconds())
	}
	return tx.SendBatch(ctx, batch).Close()
}

// NewHand is the metadata persisted when a hand starts.
type NewHand struct {
	ID             string
	GameType       string
	TableID        string
	ClubID         string
	HandNo         int64
	ButtonSeat     int
	SmallBlind     int64
	BigBlind       int64
	DeckCommitment string
	DeckEnc        []byte
	SealKeyID      int // keyring key that sealed the deck and hole cards
	LeaseEpoch     int64
	Players        []HandPlayerRecord
}

// InsertHand stores a starting hand and its participants.
func InsertHand(ctx context.Context, tx pgx.Tx, h NewHand) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO hands (id, table_id, club_id, hand_no, status, button_seat, small_blind, big_blind,
		                   deck_commitment, deck_enc, seal_key_id, lease_epoch, game_type)
		VALUES ($1, $2, $3, $4, 'IN_PROGRESS', $5, $6, $7, $8, $9, $10, $11, $12)`,
		h.ID, h.TableID, h.ClubID, h.HandNo, h.ButtonSeat, h.SmallBlind, h.BigBlind, h.DeckCommitment, h.DeckEnc, h.SealKeyID, h.LeaseEpoch, h.GameType)
	if err != nil {
		return err
	}
	batch := &pgx.Batch{}
	for _, p := range h.Players {
		batch.Queue(`INSERT INTO hand_players (hand_id, user_id, seat_no, starting_stack, hole_cards_enc) VALUES ($1, $2, $3, $4, $5)`,
			h.ID, p.UserID, p.SeatNo, p.StartingStack, p.HoleCardsEnc)
	}
	return tx.SendBatch(ctx, batch).Close()
}

// PlayerResult is a participant's final outcome.
type PlayerResult struct {
	UserID      string
	EndingStack int64
	Contributed int64
	Won         int64
	Net         int64
	Folded      bool
	ShownCards  []string // nil when cards were not revealed
}

// CompleteHand marks a hand completed with its results.
func CompleteHand(ctx context.Context, tx pgx.Tx, handID string, board []string, resultHash string, players []PlayerResult) error {
	boardJSON, _ := json.Marshal(board)
	tag, err := tx.Exec(ctx, `
		UPDATE hands SET status = 'COMPLETED', ended_at = now(), board = $2, result_hash = $3
		 WHERE id = $1 AND status = 'IN_PROGRESS'`, handID, boardJSON, resultHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("store: hand %s is not in progress", handID)
	}
	batch := &pgx.Batch{}
	for _, p := range players {
		var shown any
		if p.ShownCards != nil {
			b, _ := json.Marshal(p.ShownCards)
			shown = b
		}
		batch.Queue(`UPDATE hand_players SET ending_stack = $3, contributed = $4, won = $5, net = $6, folded = $7, shown_cards = $8
		              WHERE hand_id = $1 AND user_id = $2`,
			handID, p.UserID, p.EndingStack, p.Contributed, p.Won, p.Net, p.Folded, shown)
	}
	return tx.SendBatch(ctx, batch).Close()
}

// VoidHand marks an unfinished hand voided (no chips moved).
func VoidHand(ctx context.Context, tx pgx.Tx, handID, reason string) error {
	tag, err := tx.Exec(ctx, `UPDATE hands SET status = 'VOIDED', ended_at = now(), void_reason = $2
	                          WHERE id = $1 AND status = 'IN_PROGRESS'`, handID, reason)
	if err == nil && tag.RowsAffected() != 1 {
		return fmt.Errorf("store: hand %s is not in progress", handID)
	}
	return err
}

// VerifyTableStacks asserts that the ledger TABLE_STACK balances of a table
// equal the expected seat stacks (userID -> stack) and that no unseated
// player still has chips at the table. A mismatch means chips would be
// created or destroyed; the transaction is aborted.
func VerifyTableStacks(ctx context.Context, tx pgx.Tx, tableID string, expected map[string]int64) error {
	rows, err := tx.Query(ctx, `SELECT owner_id::text, balance FROM ledger_accounts WHERE table_id = $1 AND kind = 'TABLE_STACK'`, tableID)
	if err != nil {
		return err
	}
	balances, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (struct {
		user    string
		balance int64
	}, error) {
		var v struct {
			user    string
			balance int64
		}
		err := r.Scan(&v.user, &v.balance)
		return v, err
	})
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, b := range balances {
		want, seated := expected[b.user]
		if (!seated && b.balance != 0) || (seated && b.balance != want) {
			return fmt.Errorf("store: ledger/stack mismatch for user %s: ledger %d, table %d (seated=%v)", b.user, b.balance, want, seated)
		}
		seen[b.user] = true
	}
	for user, want := range expected {
		if !seen[user] && want != 0 {
			return fmt.Errorf("store: seated user %s has stack %d but no ledger account", user, want)
		}
	}
	return nil
}
