package table

import (
	"context"
	"errors"
	"fmt"
	"github.com/bar1287/kofclub/go/observability"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	ledger "github.com/bar1287/kofclub/go/ledger-client"
	"github.com/bar1287/kofclub/go/poker"
)

// SitRequest seats a player with a buy-in from their club wallet.
type SitRequest struct {
	UserID    string
	SeatNo    int // 0 = first free seat
	BuyIn     int64
	RequestID string // idempotency key for the buy-in
}

// SitResult describes the seat taken.
type SitResult struct {
	SeatNo int   `json:"seatNo"`
	Stack  int64 `json:"stack"`
	Seq    int64 `json:"seq"`
}

// Sit validates and performs a buy-in + seat atomically.
func (a *Actor) Sit(ctx context.Context, req SitRequest) (SitResult, error) {
	username, err := a.deps.Store.Username(ctx, req.UserID)
	if err != nil {
		return SitResult{}, newError("NOT_FOUND", "user not found")
	}
	return call(ctx, a, func() (SitResult, error) { return a.handleSit(req, username) })
}

func (a *Actor) handleSit(req SitRequest, username string) (SitResult, error) {
	defer a.afterChange()
	if a.tour != nil {
		return SitResult{}, newError("ILLEGAL_ACTION", "seats at tournament tables are assigned by the tournament")
	}
	if seat := a.table.SeatOf(poker.PlayerID(req.UserID)); seat != 0 {
		if prev, ok := a.sitRequests[req.RequestID]; ok && prev == seat {
			s, _ := a.table.SeatState(seat)
			return SitResult{SeatNo: seat, Stack: s.Stack, Seq: a.seq}, nil // idempotent retry
		}
		return SitResult{}, newError("ALREADY_SEATED", "already seated at this table")
	}
	if a.cfg.Status != "OPEN" || a.draining {
		return SitResult{}, newError("TABLE_CLOSED", "table is not accepting players")
	}
	if req.BuyIn < a.cfg.BuyInMin || req.BuyIn > a.cfg.BuyInMax {
		return SitResult{}, &Error{Code: "INVALID_BUY_IN", Message: "buy-in outside table limits",
			Details: map[string]any{"min": a.cfg.BuyInMin, "max": a.cfg.BuyInMax}}
	}
	seatNo := req.SeatNo
	free := a.table.FreeSeats()
	if seatNo == 0 {
		if len(free) == 0 {
			return SitResult{}, newError("TABLE_FULL", "no free seats")
		}
		seatNo = free[0]
	}
	if seatNo < 1 || seatNo > a.cfg.MaxSeats {
		return SitResult{}, newError("VALIDATION_FAILED", "seat does not exist")
	}
	next := a.table.Clone()
	if err := next.SitDown(seatNo, poker.PlayerID(req.UserID), req.BuyIn); err != nil {
		if len(free) == 0 {
			return SitResult{}, newError("TABLE_FULL", "no free seats")
		}
		return SitResult{}, fromEngine(err)
	}
	d := draft{kind: KindPlayerSeated, public: playerSeatedPayload{
		Kind: KindPlayerSeated, Seat: seatNo, UserID: req.UserID, Username: username, Stack: req.BuyIn,
	}}
	events, err := a.commit(next, []draft{d}, func(ctx context.Context, tx pgx.Tx) error {
		wallet, err := ledger.EnsureAccount(ctx, tx, a.cfg.ClubID, ledger.AccountMemberWallet, req.UserID, "")
		if err != nil {
			return err
		}
		stack, err := ledger.EnsureAccount(ctx, tx, a.cfg.ClubID, ledger.AccountTableStack, req.UserID, a.cfg.ID)
		if err != nil {
			return err
		}
		res, err := ledger.Post(ctx, tx, ledger.Posting{
			ExternalRef: "buyin:" + a.cfg.ID + ":" + req.RequestID, Kind: ledger.KindTableBuyIn, ClubID: a.cfg.ClubID,
			ActorUserID: req.UserID, ReferenceType: "table", ReferenceID: a.cfg.ID,
			Entries: []ledger.Entry{{AccountID: wallet, Amount: -req.BuyIn, Reason: "BUY_IN"}, {AccountID: stack, Amount: req.BuyIn, Reason: "BUY_IN"}},
		})
		if errors.Is(err, ledger.ErrInsufficientChips) {
			return newError("INSUFFICIENT_CHIPS", "not enough chips in your club wallet")
		}
		if err != nil {
			return err
		}
		if !res.Created {
			// The buy-in for this request was already applied earlier (e.g. the
			// player since left): never seat without moving chips.
			return newError("ACTION_ALREADY_PROCESSED", "this buy-in request was already processed")
		}
		if err := store.InsertSeat(ctx, tx, a.cfg.ID, seatNo, req.UserID, req.BuyIn); err != nil {
			return err
		}
		return store.VerifyTableStacks(ctx, tx, a.cfg.ID, seatStacks(next))
	})
	if err != nil {
		return SitResult{}, err
	}
	a.usernames[req.UserID] = username
	a.banks.seat(req.UserID)
	a.sitRequests[req.RequestID] = seatNo
	delete(a.leaving, req.UserID)
	a.timeouts[req.UserID] = 0
	a.log.Info("player_seated", slog.String("user_id", req.UserID), slog.Int("seat", seatNo), slog.Int64("buy_in", req.BuyIn))
	return SitResult{SeatNo: seatNo, Stack: req.BuyIn, Seq: events[0].Seq}, nil
}

// LeaveResult reports whether the player left now or after the hand.
type LeaveResult struct {
	Status  string `json:"status"` // LEFT | LEAVING_AFTER_HAND
	CashOut int64  `json:"cashOut"`
}

// Leave cashes a player out (immediately, or when the current hand ends).
func (a *Actor) Leave(ctx context.Context, userID, requestID string) (LeaveResult, error) {
	return call(ctx, a, func() (LeaveResult, error) { return a.handleLeave(userID, requestID) })
}

func (a *Actor) handleLeave(userID, requestID string) (LeaveResult, error) {
	defer a.afterChange()
	if a.tour != nil {
		return LeaveResult{}, newError("ILLEGAL_ACTION", "tournament players cannot cash out; sit out instead")
	}
	seat := a.table.SeatOf(poker.PlayerID(userID))
	if seat == 0 {
		return LeaveResult{}, newError("PLAYER_NOT_SEATED", "not seated at this table")
	}
	if a.table.InHand(seat) {
		a.leaving[userID] = true
		a.stopIfIdleDrained()
		return LeaveResult{Status: "LEAVING_AFTER_HAND"}, nil
	}
	s, _ := a.table.SeatState(seat)
	next := a.table.Clone()
	if _, err := next.StandUp(seat); err != nil {
		return LeaveResult{}, fromEngine(err)
	}
	d := draft{kind: KindPlayerLeft, public: playerLeftPayload{Kind: KindPlayerLeft, Seat: seat, UserID: userID, Reason: "LEFT", CashOut: s.Stack}}
	_, err := a.commit(next, []draft{d}, func(ctx context.Context, tx pgx.Tx) error {
		if err := a.cashOut(ctx, tx, userID, s.Stack, "cashout:"+a.cfg.ID+":"+requestID); err != nil {
			return err
		}
		if err := store.DeleteSeat(ctx, tx, a.cfg.ID, userID); err != nil {
			return err
		}
		return store.VerifyTableStacks(ctx, tx, a.cfg.ID, seatStacks(next))
	})
	if err != nil {
		return LeaveResult{}, err
	}
	delete(a.leaving, userID)
	delete(a.autoTopUp, userID)
	if _, ok := a.busted[userID]; ok {
		delete(a.busted, userID)
		a.armBustTimer()
	}
	a.log.Info("player_left", slog.String("user_id", userID), slog.Int("seat", seat), slog.Int64("cash_out", s.Stack))
	return LeaveResult{Status: "LEFT", CashOut: s.Stack}, nil
}

func (a *Actor) cashOut(ctx context.Context, tx pgx.Tx, userID string, amount int64, ref string) error {
	if amount == 0 {
		return nil
	}
	wallet, err := ledger.EnsureAccount(ctx, tx, a.cfg.ClubID, ledger.AccountMemberWallet, userID, "")
	if err != nil {
		return err
	}
	stack, err := ledger.EnsureAccount(ctx, tx, a.cfg.ClubID, ledger.AccountTableStack, userID, a.cfg.ID)
	if err != nil {
		return err
	}
	res, err := ledger.Post(ctx, tx, ledger.Posting{
		ExternalRef: ref, Kind: ledger.KindTableCashOut, ClubID: a.cfg.ClubID, ActorUserID: userID,
		ReferenceType: "table", ReferenceID: a.cfg.ID,
		Entries: []ledger.Entry{{AccountID: stack, Amount: -amount, Reason: "CASH_OUT"}, {AccountID: wallet, Amount: amount, Reason: "CASH_OUT"}},
	})
	if err != nil {
		return err
	}
	if !res.Created {
		return newError("ACTION_ALREADY_PROCESSED", "cash-out already processed")
	}
	return nil
}

// SetSittingOut toggles whether a seated player is dealt into new hands.
func (a *Actor) SetSittingOut(ctx context.Context, userID string, out bool) (int64, error) {
	return call(ctx, a, func() (int64, error) { return a.handleSittingOut(userID, out, "REQUEST") })
}

func (a *Actor) handleSittingOut(userID string, out bool, reason string) (int64, error) {
	defer a.afterChange()
	seat := a.table.SeatOf(poker.PlayerID(userID))
	if seat == 0 {
		return 0, newError("PLAYER_NOT_SEATED", "not seated at this table")
	}
	s, _ := a.table.SeatState(seat)
	if s.SittingOut == out {
		return a.seq, nil
	}
	if !out && s.Stack == 0 {
		return 0, &Error{Code: "INVALID_BUY_IN", Message: "add chips before sitting in",
			Details: map[string]any{"min": a.cfg.BuyInMin, "max": a.cfg.BuyInMax}}
	}
	next := a.table.Clone()
	_ = next.SetSittingOut(seat, out)
	d := draft{kind: KindSittingOut, public: sittingOutPayload{Kind: KindSittingOut, Seat: seat, UserID: userID, SittingOut: out, Reason: reason}}
	events, err := a.commit(next, []draft{d}, func(ctx context.Context, tx pgx.Tx) error {
		return store.SetSittingOut(ctx, tx, a.cfg.ID, userID, out)
	})
	if err != nil {
		return 0, err
	}
	if !out {
		a.timeouts[userID] = 0
	}
	return events[0].Seq, nil
}

// CommandRequest is a player intent from the realtime gateway.
type CommandRequest struct {
	UserID      string
	CommandID   string
	ExpectedSeq *int64
	Kind        string
	Amount      int64
	ReceivedAt  time.Time
}

// CommandResult links a command id to the resulting table sequence.
type CommandResult struct {
	CommandID string `json:"commandId"`
	Accepted  bool   `json:"accepted"`
	Duplicate bool   `json:"duplicate"`
	Seq       int64  `json:"seq"`
	UserID    string `json:"-"`
	Err       *Error `json:"-"`
}

// Command applies a player action (FOLD/CHECK/CALL/BET/RAISE/ALL_IN) or a
// seat command (SIT_OUT/SIT_IN). Repeating a command id returns the
// original result without re-applying it.
func (a *Actor) Command(ctx context.Context, req CommandRequest) (CommandResult, error) {
	// Spans carry ids and the action kind only, never cards (ADR-008).
	ctx, span := observability.Tracer().Start(ctx, "table.command", trace.WithAttributes(
		attribute.String("table.id", a.cfg.ID), attribute.String("command.kind", req.Kind),
		attribute.String("command.id", req.CommandID)))
	defer span.End()
	res, err := call(ctx, a, func() (CommandResult, error) { return a.handleCommand(req), nil })
	span.SetAttributes(attribute.Bool("command.accepted", res.Accepted), attribute.Bool("command.duplicate", res.Duplicate))
	if err != nil {
		return CommandResult{}, err
	}
	if !res.Duplicate && res.Accepted {
		a.deps.Metrics.CommandLatency.Observe(time.Since(req.ReceivedAt).Seconds())
	}
	if res.Err != nil {
		return res, res.Err
	}
	return res, nil
}

func (a *Actor) handleCommand(req CommandRequest) CommandResult {
	if prev, ok := a.processed.get(req.CommandID); ok {
		a.deps.Metrics.DuplicateCommands.Inc()
		if prev.UserID != req.UserID {
			return CommandResult{CommandID: req.CommandID, Err: newError("ACTION_ALREADY_PROCESSED", "command id already used")}
		}
		prev.Duplicate = true
		return prev
	}
	reject := func(e *Error) CommandResult {
		a.deps.Metrics.Rejections.WithLabelValues(e.Code).Inc()
		r := CommandResult{CommandID: req.CommandID, UserID: req.UserID, Seq: a.seq, Err: e}
		a.processed.put(req.CommandID, r)
		return r
	}

	switch req.Kind {
	case "SIT_OUT", "SIT_IN":
		seq, err := a.handleSittingOut(req.UserID, req.Kind == "SIT_OUT", "REQUEST")
		if err != nil {
			var te *Error
			if errors.As(err, &te) {
				return reject(te)
			}
			return reject(newError("INTERNAL", err.Error()))
		}
		r := CommandResult{CommandID: req.CommandID, UserID: req.UserID, Accepted: true, Seq: seq}
		a.processed.put(req.CommandID, r)
		return r
	}

	kind := poker.ActionKind(req.Kind)
	switch kind {
	case poker.ActionFold, poker.ActionCheck, poker.ActionCall, poker.ActionBet, poker.ActionRaise, poker.ActionAllIn:
	default:
		return reject(newError("ILLEGAL_ACTION", fmt.Sprintf("unknown command kind %q", req.Kind)))
	}
	seat := a.table.SeatOf(poker.PlayerID(req.UserID))
	if seat == 0 {
		return reject(newError("PLAYER_NOT_SEATED", "not seated at this table"))
	}
	hand := a.table.Hand()
	if hand == nil || hand.IsComplete() {
		return reject(newError("HAND_NOT_ACTIVE", "no hand in progress"))
	}
	if req.ExpectedSeq != nil && (*req.ExpectedSeq < a.turnSeq || *req.ExpectedSeq > a.seq) {
		return reject(&Error{Code: "STALE_GAME_STATE", Message: "client state is stale; resync",
			Details: map[string]any{"currentSeq": a.seq, "turnSeq": a.turnSeq}})
	}

	defer a.afterChange()
	res, err := a.applyAction(poker.Action{Seat: seat, Kind: kind, Amount: req.Amount}, &req)
	if err != nil {
		var te *Error
		if errors.As(err, &te) {
			if te.Code == "TABLE_UNAVAILABLE" {
				// Retryable infrastructure failure: do not cache, the client may retry.
				return CommandResult{CommandID: req.CommandID, UserID: req.UserID, Seq: a.seq, Err: te}
			}
			return reject(te)
		}
		return reject(newError("INTERNAL", "unexpected error"))
	}
	a.timeouts[req.UserID] = 0
	a.processed.put(req.CommandID, res)
	return res
}

// applyAction applies an action for the current actor, persisting the
// events (and settlement when the hand completes). req is nil for
// server-initiated actions (timeouts, leaving players).
func (a *Actor) applyAction(action poker.Action, req *CommandRequest) (CommandResult, error) {
	next := a.table.Clone()
	evs, err := next.Act(action)
	if err != nil {
		return CommandResult{}, fromEngine(err)
	}
	timeout := req == nil
	drafts := translate(a.handID, a.commitment, evs, timeout)

	var extra []draft
	var works []func(ctx context.Context, tx pgx.Tx) error

	// The actor keeps what is left of a running time bank; a timeout during
	// it uses it all up.
	actorSeat, _ := a.table.SeatState(action.Seat)
	actorUser := string(actorSeat.Player)
	var bankLeft *time.Duration
	if a.inTimeBank() {
		left := time.Duration(0)
		if !timeout {
			left = a.banks.afterSpending(actorUser, time.Since(a.bankStart))
		}
		bankLeft = &left
		works = append(works, func(ctx context.Context, tx pgx.Tx) error {
			return store.UpdateSeatTimeBanks(ctx, tx, a.cfg.ID, map[string]time.Duration{actorUser: left})
		})
	}
	remaining := a.banks.get(actorUser).Milliseconds()
	if bankLeft != nil {
		remaining = bankLeft.Milliseconds()
	}
	for i := range drafts {
		if p, ok := drafts[i].public.(playerActedPayload); ok && p.Seat == action.Seat {
			p.TimeBankMs = &remaining
			drafts[i].public = p
		}
	}
	if req == nil {
		// Automatic sit-out after repeated timeouts (also when the timeout
		// action itself ends the hand).
		s, _ := next.SeatState(action.Seat)
		user := string(s.Player)
		if a.timeouts[user]+1 >= a.deps.Timing.MaxTimeouts && !s.SittingOut && !a.leaving[user] {
			_ = next.SetSittingOut(action.Seat, true)
			extra = append(extra, draft{kind: KindSittingOut, public: sittingOutPayload{
				Kind: KindSittingOut, Seat: action.Seat, UserID: user, SittingOut: true, Reason: "TIMEOUTS",
			}})
			works = append(works, func(ctx context.Context, tx pgx.Tx) error { return store.SetSittingOut(ctx, tx, a.cfg.ID, user, true) })
		}
	}
	var endBuild func(ctx context.Context, tx pgx.Tx) ([]draft, error)
	if next.Hand().IsComplete() {
		if endBuild, err = a.handEnd(next, evs); err != nil {
			return CommandResult{}, err
		}
	}
	drafts = append(drafts, extra...)
	if t := a.turnDraft(next); t != nil {
		drafts = append(drafts, *t)
	}

	handID := a.handID
	events, err := a.commitTx(next, func(ctx context.Context, tx pgx.Tx) ([]draft, error) {
		if req != nil {
			if err := store.InsertCommand(ctx, tx, a.cfg.ID, req.CommandID, req.UserID, handID, req.Kind, req.Amount, a.seq+1); err != nil {
				if errors.Is(err, store.ErrDuplicate) {
					return nil, newError("ACTION_ALREADY_PROCESSED", "command already applied")
				}
				return nil, err
			}
		}
		for _, w := range works {
			if err := w(ctx, tx); err != nil {
				return nil, err
			}
		}
		if endBuild == nil {
			return drafts, nil
		}
		more, err := endBuild(ctx, tx)
		if err != nil {
			return nil, err
		}
		return append(append([]draft(nil), drafts...), more...), nil
	})
	if err != nil {
		return CommandResult{}, err
	}
	if bankLeft != nil {
		a.banks.set(map[string]time.Duration{actorUser: *bankLeft})
	}
	source := "player"
	if timeout {
		source = "server"
	}
	a.deps.Metrics.Actions.WithLabelValues(string(action.Kind), source).Inc()
	if next.Hand() != nil && next.Hand().IsComplete() {
		a.onHandFinished()
	}
	res := CommandResult{Accepted: true, Seq: events[0].Seq}
	if req != nil {
		res.CommandID, res.UserID = req.CommandID, req.UserID
	}
	return res, nil
}

func (a *Actor) onTurnTimeout(token int64) {
	if token != a.turnToken {
		return // stale timer
	}
	hand := a.table.Hand()
	if hand == nil || hand.IsComplete() {
		return
	}
	action, ok := hand.DefaultAction()
	if !ok {
		return
	}
	s, _ := a.table.SeatState(action.Seat)
	user := string(s.Player)
	leaving := a.leaving[user]
	// The turn timer ran out: a player with time in the bank gets it first
	// (not players leaving or absent from a tournament, who act at once).
	if a.bankToken != token && !leaving && !(a.tour != nil && s.SittingOut) && a.banks.get(user) > 0 {
		a.startTimeBank(token, action.Seat, user)
		return
	}
	if _, err := a.applyAction(action, nil); err != nil {
		a.log.Warn("timeout_action_failed", slog.String("error", err.Error()))
		// Retry later with the same deadline token while storage recovers.
		a.stopTimers()
		a.turnTimer = time.AfterFunc(a.deps.Timing.RetryBackoff, func() { a.post(func() { a.onTurnTimeout(token) }) })
		return
	}
	if !leaving {
		a.timeouts[user]++
		a.deps.Metrics.Timeouts.Inc()
	}
	a.afterChange()
}

// seatStacks maps seated users to the TABLE_STACK ledger balance they must
// have. Only net hand results are settled, so players in an unfinished hand
// still hold their start-of-hand stack in the ledger.
func seatStacks(t *poker.Table) map[string]int64 {
	out := map[string]int64{}
	for _, s := range t.Seats() {
		out[string(s.Player)] = s.Stack
	}
	if h := t.Hand(); h != nil && !h.IsComplete() {
		for _, p := range h.Players() {
			if _, seated := out[string(p.Player)]; seated {
				out[string(p.Player)] = p.Stack + p.Contributed
			}
		}
	}
	return out
}
