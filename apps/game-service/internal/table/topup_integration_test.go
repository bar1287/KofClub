//go:build integration

package table_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/bar1287/kofclub/apps/game-service/internal/table"
	"github.com/bar1287/kofclub/go/poker"
)

func (e *env) topUp(a *table.Actor, name string, amount int64, requestID string) (table.TopUpResult, error) {
	e.t.Helper()
	return a.TopUp(e.ctx, table.TopUpRequest{UserID: e.users[name], Amount: amount, RequestID: requestID})
}

func errCode(err error) string {
	var te *table.Error
	if errors.As(err, &te) {
		return te.Code
	}
	return ""
}

func (e *env) seatOf(a *table.Actor, name string) (table.SeatView, bool) {
	e.t.Helper()
	for _, s := range e.snapshot(a, "").Seats {
		if s.UserID == e.users[name] {
			return s, true
		}
	}
	return table.SeatView{}, false
}

// allIn moves all chips in whenever possible (busts players quickly).
func allIn(las []poker.LegalAction) (string, int64) {
	for _, la := range las {
		if la.Kind == poker.ActionAllIn {
			return "ALL_IN", la.Amount
		}
	}
	return passive(las)
}

// Top-ups (roadmap W1.3): applied at once between hands, waiting for the
// hand to end when the player is in one; the stack stays within the table's
// buy-in limits, the wallet pays, and a retried request is applied once.
func TestTopUpBetweenHandsAndAfterAHand(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	a := e.start("node-1", fast)
	e.sit(a, "alice", 1, 1000)

	res, err := e.topUp(a, "alice", 500, "top-1")
	if err != nil || res.Status != "APPLIED" || res.Stack != 1500 {
		t.Fatalf("top-up between hands: %+v %v", res, err)
	}
	if again, err := e.topUp(a, "alice", 500, "top-1"); err != nil || again != res {
		t.Fatalf("a retried request must return the first result: %+v %v", again, err)
	}
	if _, err := e.topUp(a, "alice", 600, "top-2"); errCode(err) != "INVALID_BUY_IN" {
		t.Fatalf("above the table maximum: %v", err)
	}
	if _, err := e.topUp(a, "bob", 100, "top-3"); errCode(err) != "PLAYER_NOT_SEATED" {
		t.Fatalf("not seated: %v", err)
	}
	if got := e.walletBalance("alice"); got != 5000-1000-500 {
		t.Fatalf("wallet after one top-up: %d", got)
	}

	// During a hand the chips wait for it to end.
	e.sit(a, "bob", 2, 1000)
	waitFor(t, "hand start", 5*time.Second, func() bool {
		s := e.snapshot(a, "")
		return s.Hand != nil && s.Hand.ToActSeat != 0
	})
	if _, err := e.topUp(a, "alice", 5000, "top-4"); errCode(err) != "INVALID_BUY_IN" {
		t.Fatalf("limits apply to queued top-ups too: %v", err)
	}
	pending, err := e.topUp(a, "alice", 200, "top-5")
	if err != nil || pending.Status != "PENDING" || pending.Pending != 200 || pending.Stack > 1500 {
		t.Fatalf("top-up during a hand: %+v %v", pending, err)
	}
	if you := e.snapshot(a, e.users["alice"]).You; you.PendingTopUp != 200 {
		t.Fatalf("snapshot pending: %+v", you)
	}
	if e.walletBalance("alice") != 3500 {
		t.Fatal("no chips may move before the hand ends")
	}
	e.playHandToEnd(a, passive)
	waitFor(t, "pending top-up applied", 5*time.Second, func() bool { return e.walletBalance("alice") == 3300 })
	if you := e.snapshot(a, e.users["alice"]).You; you.PendingTopUp != 0 {
		t.Fatalf("pending after the hand: %+v", you)
	}
	var toppedUp int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM game_events WHERE table_id = $1 AND event_type = 'PLAYER_TOPPED_UP'`, e.tableID).Scan(&toppedUp)
	if toppedUp != 2 {
		t.Fatalf("PLAYER_TOPPED_UP events: %d", toppedUp)
	}
	e.assertChipsConsistent()
}

// A player who runs out of chips keeps the seat, sitting out, until the
// grace period ends; a re-buy (at least the minimum) deals them in again;
// otherwise the seat is released. Busted seats survive a restart.
func TestBustedPlayerKeepsTheSeatToRebuy(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	timing := fast
	timing.BustGrace = 2 * time.Second
	a := e.start("node-1", timing)
	e.sit(a, "alice", 1, 100)
	e.sit(a, "bob", 2, 2000)

	busted := ""
	for i := 0; i < 40 && busted == ""; i++ {
		e.playHandToEnd(a, allIn)
		waitFor(t, "hand settled", 5*time.Second, func() bool {
			s := e.snapshot(a, "")
			return s.Hand == nil || s.Hand.ToActSeat == 0
		})
		for _, s := range e.snapshot(a, "").Seats {
			if s.Stack == 0 {
				busted = e.nameOf(s.UserID)
			}
		}
	}
	if busted == "" {
		t.Fatal("nobody busted")
	}
	waitFor(t, "busted seat kept", 2*time.Second, func() bool {
		s, ok := e.seatOf(a, busted)
		return ok && s.SittingOut && s.BustedUntil != nil
	})
	if s := e.snapshot(a, ""); s.Hand != nil && s.Hand.ToActSeat != 0 {
		t.Fatal("no hand may be dealt to a single player")
	}
	if _, err := a.SetSittingOut(e.ctx, e.users[busted], false); errCode(err) != "INVALID_BUY_IN" {
		t.Fatalf("sitting in without chips: %v", err)
	}
	if _, err := e.topUp(a, busted, 50, "rebuy-small"); errCode(err) != "INVALID_BUY_IN" {
		t.Fatalf("a re-buy must reach the minimum: %v", err)
	}

	// Restart: the busted seat is restored with a new grace period.
	a.Stop(nil)
	<-a.Done()
	a = e.start("node-1", timing)
	s, ok := e.seatOf(a, busted)
	if !ok || s.Stack != 0 || s.BustedUntil == nil {
		t.Fatalf("busted seat after restart: %+v %v", s, ok)
	}

	res, err := e.topUp(a, busted, 300, "rebuy-"+uuid.NewString())
	if err != nil || res.Status != "APPLIED" || res.Stack != 300 {
		t.Fatalf("re-buy: %+v %v", res, err)
	}
	s, _ = e.seatOf(a, busted)
	if s.SittingOut || s.BustedUntil != nil {
		t.Fatalf("a re-bought player is dealt in again: %+v", s)
	}
	waitFor(t, "hand after the re-buy", 5*time.Second, func() bool {
		s := e.snapshot(a, "")
		return s.Hand != nil && s.Hand.ToActSeat != 0
	})

	// Bust again and let the grace period pass: the seat is released.
	busted = ""
	for i := 0; i < 40 && busted == ""; i++ {
		e.playHandToEnd(a, allIn)
		waitFor(t, "hand settled", 5*time.Second, func() bool {
			s := e.snapshot(a, "")
			return s.Hand == nil || s.Hand.ToActSeat == 0
		})
		for _, s := range e.snapshot(a, "").Seats {
			if s.Stack == 0 {
				busted = e.nameOf(s.UserID)
			}
		}
	}
	if busted == "" {
		t.Fatal("nobody busted the second time")
	}
	waitFor(t, "busted seat released", 5*time.Second, func() bool {
		_, seated := e.seatOf(a, busted)
		return !seated
	})
	var rows int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM table_seats WHERE table_id = $1 AND user_id = $2`, e.tableID, e.users[busted]).Scan(&rows)
	if rows != 0 {
		t.Fatal("released seat still persisted")
	}
	e.assertChipsConsistent()
}

// Automatic top-up: after every hand the stack is topped back up to the
// player's target (within the buy-in limits; 0 turns it off).
func TestAutoTopUpAfterEveryHand(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	a := e.start("node-1", fast)
	e.sit(a, "alice", 1, 600)
	if _, err := a.SetAutoTopUp(e.ctx, e.users["alice"], 5000); errCode(err) != "INVALID_BUY_IN" {
		t.Fatalf("target above the maximum: %v", err)
	}
	// Setting a target above the stack tops up at once (no hand running).
	if to, err := a.SetAutoTopUp(e.ctx, e.users["alice"], 1000); err != nil || to != 1000 {
		t.Fatalf("set target: %d %v", to, err)
	}
	if s, _ := e.seatOf(a, "alice"); s.Stack != 1000 {
		t.Fatalf("immediate top-up to the target: %+v", s)
	}
	if you := e.snapshot(a, e.users["alice"]).You; you.AutoTopUpTo != 1000 {
		t.Fatalf("snapshot target: %+v", you)
	}
	e.sit(a, "bob", 2, 1000)
	// Three hands: alice's wallet (4,000 after the first top-up) covers a
	// full re-buy after each of them.
	for i := 0; i < 3; i++ {
		e.playHandToEnd(a, allIn)
		waitFor(t, "alice back at her target", 5*time.Second, func() bool {
			s, seated := e.seatOf(a, "alice")
			return seated && s.Stack >= 1000
		})
		if _, seated := e.seatOf(a, "bob"); !seated {
			break // bob busted and left (no target)
		}
		if s, _ := e.seatOf(a, "bob"); s.Stack == 0 {
			break
		}
	}
	if to, err := a.SetAutoTopUp(e.ctx, e.users["alice"], 0); err != nil || to != 0 {
		t.Fatalf("turn off: %d %v", to, err)
	}
	var stored int64
	_ = e.pool.QueryRow(e.ctx, `SELECT auto_top_up_to FROM table_seats WHERE table_id = $1 AND user_id = $2`, e.tableID, e.users["alice"]).Scan(&stored)
	if stored != 0 {
		t.Fatalf("stored target: %d", stored)
	}
	e.assertChipsConsistent()
}
