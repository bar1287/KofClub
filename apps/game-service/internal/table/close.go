package table

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/bar1287/kofclub/apps/game-service/internal/store"
)

// Closing a table (M7). The control plane marks the directory row CLOSED and
// notifies the owning actor, which stops dealing and cashes every seat out
// to the club wallet as soon as no hand is in progress. CLOSED is terminal.
// The actor also re-reads the directory status before every hand and on
// start, so it converges even when a notification is lost.

// CloseResult reports the closure progress.
type CloseResult struct {
	Status string `json:"status"` // CLOSED (no players left) | CLOSING (waiting for the hand)
	Seated int    `json:"seated"`
}

type tableClosedPayload struct {
	Kind string `json:"kind"`
}

// KindTableClosed announces that the table accepts no new hands or players.
const KindTableClosed = "TABLE_CLOSED"

// Close applies a closure requested by the control plane.
func (a *Actor) Close(ctx context.Context) (CloseResult, error) {
	return call(ctx, a, func() (CloseResult, error) {
		defer a.afterChange()
		a.cfg.Status = "CLOSED"
		if err := a.closeIfIdle(); err != nil {
			return CloseResult{}, err
		}
		return a.closeStatus(), nil
	})
}

func (a *Actor) closeStatus() CloseResult {
	n := len(a.table.Seats())
	if n == 0 {
		return CloseResult{Status: "CLOSED"}
	}
	return CloseResult{Status: "CLOSING", Seated: n}
}

// closeIfIdle announces the closure and, when no hand is running, stands
// every player up with a cash-out in one atomic commit.
func (a *Actor) closeIfIdle() error {
	if a.cfg.Status != "CLOSED" {
		return nil
	}
	var drafts []draft
	if !a.closeAnnounced {
		drafts = append(drafts, draft{kind: KindTableClosed, public: tableClosedPayload{Kind: KindTableClosed}})
	}
	if h := a.table.Hand(); h != nil && !h.IsComplete() {
		if len(drafts) == 0 {
			return nil
		}
		// Announce now; seats are cashed out when the hand ends.
		if _, err := a.commit(a.table.Clone(), drafts, nil); err != nil {
			return err
		}
		a.closeAnnounced = true
		return nil
	}

	next := a.table.Clone()
	type payout struct {
		user  string
		stack int64
	}
	var payouts []payout
	for _, s := range a.table.Seats() {
		if _, err := next.StandUp(s.Seat); err != nil {
			return fromEngine(err)
		}
		user := string(s.Player)
		payouts = append(payouts, payout{user: user, stack: s.Stack})
		drafts = append(drafts, draft{kind: KindPlayerLeft, public: playerLeftPayload{
			Kind: KindPlayerLeft, Seat: s.Seat, UserID: user, Reason: "TABLE_CLOSED", CashOut: s.Stack,
		}})
	}
	if len(drafts) == 0 {
		return nil
	}
	_, err := a.commit(next, drafts, func(ctx context.Context, tx pgx.Tx) error {
		for _, p := range payouts {
			// CLOSED is terminal, so one closing cash-out per player and table.
			if err := a.cashOut(ctx, tx, p.user, p.stack, "close:"+a.cfg.ID+":"+p.user); err != nil {
				return err
			}
			if err := store.DeleteSeat(ctx, tx, a.cfg.ID, p.user); err != nil {
				return err
			}
		}
		return store.VerifyTableStacks(ctx, tx, a.cfg.ID, seatStacks(next))
	})
	if err != nil {
		return err
	}
	a.closeAnnounced = true
	for _, p := range payouts {
		delete(a.leaving, p.user)
	}
	a.log.Info("table_closed", slog.Int("cashed_out", len(payouts)))
	return nil
}

// refreshStatus re-reads the directory status (before dealing a hand).
func (a *Actor) refreshStatus() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	status, err := a.deps.Store.TableStatus(ctx, a.cfg.ID)
	if err != nil {
		a.log.Warn("table_status_refresh_failed", slog.String("error", err.Error()))
		return
	}
	if status != a.cfg.Status && status == "CLOSED" {
		a.cfg.Status = status
		if err := a.closeIfIdle(); err != nil {
			a.log.Warn("table_close_failed", slog.String("error", err.Error()))
		}
	}
}
