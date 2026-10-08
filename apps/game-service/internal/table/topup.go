package table

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	ledger "github.com/bar1287/kofclub/go/ledger-client"
	"github.com/bar1287/kofclub/go/poker"
)

// Re-buy and top-up (roadmap W1.3).
//
// A seated cash-table player adds chips from the club wallet: at once when
// they are not in the hand in progress, otherwise when it ends (stacks never
// change during a hand, and no chips move before then). The stack afterwards
// may not exceed the table's maximum buy-in; a re-buy from an empty stack
// must reach the minimum. A player can also ask to be topped back up to a
// target after every hand.
//
// A player who runs out of chips keeps the seat, sitting out, for a grace
// period (Timing.BustGrace) to re-buy; then the seat is released.

// DefaultBustGrace is how long a busted player keeps the seat.
const DefaultBustGrace = 60 * time.Second

// TopUpRequest adds chips to a seated player's stack.
type TopUpRequest struct {
	UserID    string
	Amount    int64
	RequestID string
}

// TopUpResult reports a top-up applied now or waiting for the hand to end.
type TopUpResult struct {
	Status  string `json:"status"` // APPLIED | PENDING
	Stack   int64  `json:"stack"`
	Pending int64  `json:"pending"`
	Seq     int64  `json:"seq"`
}

// topUpPart is one request's chips and its ledger reference.
type topUpPart struct {
	ref    string
	amount int64
}

// fitParts trims parts (latest first) so that they add at most room chips.
func fitParts(parts []topUpPart, room int64) []topUpPart {
	out := make([]topUpPart, 0, len(parts))
	for _, p := range parts {
		if room <= 0 {
			break
		}
		p.amount = min(p.amount, room)
		room -= p.amount
		out = append(out, p)
	}
	return out
}

func partsTotal(parts []topUpPart) int64 {
	var n int64
	for _, p := range parts {
		n += p.amount
	}
	return n
}

func (a *Actor) bustGrace() time.Duration {
	if a.deps.Timing.BustGrace > 0 {
		return a.deps.Timing.BustGrace
	}
	return DefaultBustGrace
}

// TopUp adds chips to a seated player's stack.
func (a *Actor) TopUp(ctx context.Context, req TopUpRequest) (TopUpResult, error) {
	return call(ctx, a, func() (TopUpResult, error) { return a.handleTopUp(req) })
}

func (a *Actor) handleTopUp(req TopUpRequest) (TopUpResult, error) {
	defer a.afterChange()
	if a.tour != nil {
		return TopUpResult{}, newError("ILLEGAL_ACTION", "tournament chips come from the tournament")
	}
	if prev, ok := a.topUpRequests[req.RequestID]; ok {
		return prev, nil // idempotent retry
	}
	seat := a.table.SeatOf(poker.PlayerID(req.UserID))
	if seat == 0 {
		return TopUpResult{}, newError("PLAYER_NOT_SEATED", "not seated at this table")
	}
	if a.cfg.Status != "OPEN" || a.draining {
		return TopUpResult{}, newError("TABLE_CLOSED", "table is not accepting chips")
	}
	if req.Amount <= 0 {
		return TopUpResult{}, newError("VALIDATION_FAILED", "amount must be positive")
	}
	s, _ := a.table.SeatState(seat)
	queued := partsTotal(a.pendingTopUps[req.UserID])
	// Limits use the chips the player owns at the table: in a hand, the
	// stack it started with (the result is checked again when it ends).
	have := seatStacks(a.table)[req.UserID] + queued
	if total := have + req.Amount; total > a.cfg.BuyInMax || (have == 0 && total < a.cfg.BuyInMin) {
		return TopUpResult{}, &Error{Code: "INVALID_BUY_IN", Message: "the stack would be outside the table's buy-in limits",
			Details: map[string]any{"min": a.cfg.BuyInMin, "max": a.cfg.BuyInMax, "stack": have}}
	}
	part := topUpPart{ref: "topup:" + a.cfg.ID + ":" + req.RequestID, amount: req.Amount}
	if !a.table.InHand(seat) {
		res, err := a.applyTopUp(req.UserID, []topUpPart{part})
		if err == nil {
			a.topUpRequests[req.RequestID] = res
		}
		return res, err
	}
	// In a hand: check the wallet now so a shortfall is reported at once;
	// the chips move when the hand ends.
	if err := a.checkWallet(req.UserID, queued+req.Amount); err != nil {
		return TopUpResult{}, err
	}
	a.pendingTopUps[req.UserID] = append(a.pendingTopUps[req.UserID], part)
	res := TopUpResult{Status: "PENDING", Stack: s.Stack, Pending: queued + req.Amount, Seq: a.seq}
	a.topUpRequests[req.RequestID] = res
	return res, nil
}

// checkWallet fails with INSUFFICIENT_CHIPS unless the user's club wallet
// holds at least amount.
func (a *Actor) checkWallet(userID string, amount int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wallet, err := ledger.EnsureAccount(ctx, a.deps.Store.Pool, a.cfg.ClubID, ledger.AccountMemberWallet, userID, "")
	if err != nil {
		return newError("TABLE_UNAVAILABLE", "could not read the wallet; retry")
	}
	balance, err := ledger.Balance(ctx, a.deps.Store.Pool, wallet)
	if err != nil {
		return newError("TABLE_UNAVAILABLE", "could not read the wallet; retry")
	}
	if balance < amount {
		return newError("INSUFFICIENT_CHIPS", "not enough chips in your club wallet")
	}
	return nil
}

// applyTopUp moves the parts' chips from the wallet to the seated user's
// stack (one ledger posting per part) and announces PLAYER_TOPPED_UP. A
// busted player is dealt in again.
func (a *Actor) applyTopUp(userID string, parts []topUpPart) (TopUpResult, error) {
	seat := a.table.SeatOf(poker.PlayerID(userID))
	if seat == 0 {
		return TopUpResult{}, newError("PLAYER_NOT_SEATED", "not seated at this table")
	}
	s, _ := a.table.SeatState(seat)
	amount := partsTotal(parts)
	next := a.table.Clone()
	if err := next.AddChips(seat, amount); err != nil {
		return TopUpResult{}, fromEngine(err)
	}
	stack := s.Stack + amount
	drafts := []draft{{kind: KindPlayerToppedUp, public: playerToppedUpPayload{
		Kind: KindPlayerToppedUp, Seat: seat, UserID: userID, Amount: amount, Stack: stack,
	}}}
	_, busted := a.busted[userID]
	sitIn := busted && s.SittingOut
	if sitIn {
		_ = next.SetSittingOut(seat, false)
		drafts = append(drafts, draft{kind: KindSittingOut, public: sittingOutPayload{
			Kind: KindSittingOut, Seat: seat, UserID: userID, SittingOut: false, Reason: "TOP_UP",
		}})
	}
	events, err := a.commit(next, drafts, func(ctx context.Context, tx pgx.Tx) error {
		wallet, err := ledger.EnsureAccount(ctx, tx, a.cfg.ClubID, ledger.AccountMemberWallet, userID, "")
		if err != nil {
			return err
		}
		account, err := ledger.EnsureAccount(ctx, tx, a.cfg.ClubID, ledger.AccountTableStack, userID, a.cfg.ID)
		if err != nil {
			return err
		}
		for _, p := range parts {
			res, err := ledger.Post(ctx, tx, ledger.Posting{
				ExternalRef: p.ref, Kind: ledger.KindTableBuyIn, ClubID: a.cfg.ClubID,
				ActorUserID: userID, ReferenceType: "table", ReferenceID: a.cfg.ID,
				Entries: []ledger.Entry{{AccountID: wallet, Amount: -p.amount, Reason: "TOP_UP"}, {AccountID: account, Amount: p.amount, Reason: "TOP_UP"}},
			})
			if errors.Is(err, ledger.ErrInsufficientChips) {
				return newError("INSUFFICIENT_CHIPS", "not enough chips in your club wallet")
			}
			if err != nil {
				return err
			}
			if !res.Created {
				return newError("ACTION_ALREADY_PROCESSED", "this top-up was already processed")
			}
		}
		if err := store.UpdateSeatStacks(ctx, tx, a.cfg.ID, map[string]int64{userID: stack}); err != nil {
			return err
		}
		if sitIn {
			if err := store.SetSittingOut(ctx, tx, a.cfg.ID, userID, false); err != nil {
				return err
			}
		}
		return store.VerifyTableStacks(ctx, tx, a.cfg.ID, seatStacks(next))
	})
	if err != nil {
		return TopUpResult{}, err
	}
	if busted {
		delete(a.busted, userID)
		a.armBustTimer()
	}
	a.deps.Metrics.TopUps.Inc()
	a.log.Info("player_topped_up", slog.String("user_id", userID), slog.Int64("amount", amount), slog.Int64("stack", stack))
	return TopUpResult{Status: "APPLIED", Stack: stack, Seq: events[0].Seq}, nil
}

// SetAutoTopUp sets the stack a player is topped back up to after every
// hand (0 = off) and returns it. Below the target and out of a hand, the
// top-up happens at once.
func (a *Actor) SetAutoTopUp(ctx context.Context, userID string, to int64) (int64, error) {
	return call(ctx, a, func() (int64, error) { return a.handleAutoTopUp(userID, to) })
}

func (a *Actor) handleAutoTopUp(userID string, to int64) (int64, error) {
	defer a.afterChange()
	if a.tour != nil {
		return 0, newError("ILLEGAL_ACTION", "tournament chips come from the tournament")
	}
	seat := a.table.SeatOf(poker.PlayerID(userID))
	if seat == 0 {
		return 0, newError("PLAYER_NOT_SEATED", "not seated at this table")
	}
	if to < 0 || (to != 0 && (to < a.cfg.BuyInMin || to > a.cfg.BuyInMax)) {
		return 0, &Error{Code: "INVALID_BUY_IN", Message: "the target must be within the table's buy-in limits",
			Details: map[string]any{"min": a.cfg.BuyInMin, "max": a.cfg.BuyInMax}}
	}
	if _, err := a.commit(a.table, nil, func(ctx context.Context, tx pgx.Tx) error {
		return store.SetAutoTopUp(ctx, tx, a.cfg.ID, userID, to)
	}); err != nil {
		return 0, err
	}
	if to == 0 {
		delete(a.autoTopUp, userID)
		return 0, nil
	}
	a.autoTopUp[userID] = to
	if s, _ := a.table.SeatState(seat); !a.table.InHand(seat) && s.Stack < to && a.cfg.Status == "OPEN" && !a.draining {
		part := topUpPart{ref: "topup:" + a.cfg.ID + ":auto:" + uuid.Must(uuid.NewV7()).String(), amount: to - s.Stack}
		if _, err := a.applyTopUp(userID, []topUpPart{part}); err != nil {
			a.log.Info("auto_top_up_skipped", slog.String("user_id", userID), slog.String("error", err.Error()))
		}
	}
	return to, nil
}

// settleTopUps runs when a hand ends: it applies the top-ups players asked
// for during the hand, then automatic top-ups, then gives players left
// without chips their grace period.
func (a *Actor) settleTopUps() {
	if a.tour != nil {
		return
	}
	open := a.cfg.Status == "OPEN" && !a.draining
	for user, parts := range a.pendingTopUps {
		delete(a.pendingTopUps, user)
		seat := a.table.SeatOf(poker.PlayerID(user))
		if !open || a.leaving[user] || seat == 0 {
			continue // nothing moved yet: dropping the request costs nothing
		}
		// Winning the hand may leave less room under the maximum buy-in.
		s, _ := a.table.SeatState(seat)
		if parts = fitParts(parts, a.cfg.BuyInMax-s.Stack); len(parts) == 0 {
			continue
		}
		if _, err := a.applyTopUp(user, parts); err != nil {
			a.log.Warn("top_up_dropped", slog.String("user_id", user), slog.String("error", err.Error()))
		}
	}
	for user, to := range a.autoTopUp {
		seat := a.table.SeatOf(poker.PlayerID(user))
		if seat == 0 {
			delete(a.autoTopUp, user)
			continue
		}
		s, _ := a.table.SeatState(seat)
		if !open || a.leaving[user] || s.Stack >= to {
			continue
		}
		part := topUpPart{ref: "topup:" + a.cfg.ID + ":auto:" + a.handID + ":" + user, amount: to - s.Stack}
		if _, err := a.applyTopUp(user, []topUpPart{part}); err != nil {
			a.log.Info("auto_top_up_skipped", slog.String("user_id", user), slog.String("error", err.Error()))
		}
	}
	a.markBusted()
}

// markBusted gives every seated player without chips (who is not leaving)
// the grace period to re-buy: they sit out until then.
func (a *Actor) markBusted() {
	now := time.Now()
	next := a.table.Clone()
	var drafts []draft
	var users []string
	for _, s := range a.table.Seats() {
		user := string(s.Player)
		if _, known := a.busted[user]; s.Stack > 0 || known || a.leaving[user] {
			continue
		}
		until := now.Add(a.bustGrace()).UTC()
		a.busted[user] = until // the release timer applies even if the event below fails
		_ = next.SetSittingOut(s.Seat, true)
		drafts = append(drafts, draft{kind: KindSittingOut, public: sittingOutPayload{
			Kind: KindSittingOut, Seat: s.Seat, UserID: user, SittingOut: true, Reason: "BUSTED", Until: &until,
		}})
		users = append(users, user)
	}
	if len(drafts) > 0 {
		if _, err := a.commit(next, drafts, func(ctx context.Context, tx pgx.Tx) error {
			for _, u := range users {
				if err := store.SetSittingOut(ctx, tx, a.cfg.ID, u, true); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			a.log.Warn("busted_announce_failed", slog.String("error", err.Error()))
		}
	}
	a.armBustTimer()
}

// armBustTimer schedules the release of the earliest expiring busted seat.
func (a *Actor) armBustTimer() {
	if a.bustTimer != nil {
		a.bustTimer.Stop()
		a.bustTimer = nil
	}
	var first time.Time
	for _, until := range a.busted {
		if first.IsZero() || until.Before(first) {
			first = until
		}
	}
	if first.IsZero() {
		return
	}
	a.bustTimer = time.AfterFunc(max(time.Until(first), 0), func() { a.post(a.releaseBusted) })
}

// releaseBusted frees the seats of busted players whose grace has passed.
func (a *Actor) releaseBusted() {
	now := time.Now()
	next := a.table.Clone()
	var drafts []draft
	var users []string
	for user, until := range a.busted {
		if until.After(now) {
			continue
		}
		seat := a.table.SeatOf(poker.PlayerID(user))
		if s, _ := a.table.SeatState(seat); seat == 0 || s.Stack > 0 {
			delete(a.busted, user)
			continue
		}
		if _, err := next.StandUp(seat); err != nil {
			continue // in a hand (cannot happen without chips): retried later
		}
		drafts = append(drafts, draft{kind: KindPlayerLeft, public: playerLeftPayload{
			Kind: KindPlayerLeft, Seat: seat, UserID: user, Reason: "BUSTED",
		}})
		users = append(users, user)
	}
	if len(users) > 0 {
		if _, err := a.commit(next, drafts, func(ctx context.Context, tx pgx.Tx) error {
			for _, u := range users {
				if err := store.DeleteSeat(ctx, tx, a.cfg.ID, u); err != nil {
					return err
				}
			}
			return store.VerifyTableStacks(ctx, tx, a.cfg.ID, seatStacks(next))
		}); err != nil {
			a.log.Warn("busted_release_failed", slog.String("error", err.Error()))
			a.bustTimer = time.AfterFunc(a.deps.Timing.RetryBackoff, func() { a.post(a.releaseBusted) })
			return
		}
		for _, u := range users {
			delete(a.busted, u)
			delete(a.autoTopUp, u)
			a.log.Info("busted_seat_released", slog.String("user_id", u))
		}
	}
	a.armBustTimer()
}
