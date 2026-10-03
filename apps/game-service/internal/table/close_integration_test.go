//go:build integration

package table_test

import (
	"errors"
	"testing"
	"time"

	"github.com/bar1287/kofclub/apps/game-service/internal/table"
)

func (e *env) closeInDirectory() {
	e.exec(`UPDATE tables SET status = 'CLOSED' WHERE id = $1`, e.tableID)
}

func (e *env) waitEmpty(a *table.Actor) {
	e.t.Helper()
	waitFor(e.t, "all seats cashed out", 5*time.Second, func() bool { return len(e.snapshot(a, "").Seats) == 0 })
}

func (e *env) assertClosedAndSettled(a *table.Actor, players ...string) {
	e.t.Helper()
	snap := e.snapshot(a, "")
	if snap.Table.Status != "CLOSED" || len(snap.Seats) != 0 {
		e.t.Fatalf("table should be closed and empty: %+v", snap)
	}
	var wallets int64
	for _, p := range players {
		wallets += e.walletBalance(p)
	}
	if wallets != e.granted {
		e.t.Fatalf("every chip must be back in the wallets: %d of %d", wallets, e.granted)
	}
	var stacks int64
	_ = e.pool.QueryRow(e.ctx, `SELECT coalesce(sum(balance), 0)::bigint FROM ledger_accounts WHERE table_id = $1`, e.tableID).Scan(&stacks)
	if stacks != 0 {
		e.t.Fatalf("table stacks should be empty, got %d", stacks)
	}
	e.assertChipsConsistent()
	if _, err := a.Sit(e.ctx, table.SitRequest{UserID: e.users[players[0]], SeatNo: 1, BuyIn: 500, RequestID: "after-close"}); !errors.Is(err, &table.Error{Code: "TABLE_CLOSED"}) {
		e.t.Fatalf("closed table must refuse players, got %v", err)
	}
}

// Closing mid-hand announces the closure at once, lets the hand finish, then
// cashes every seat out to the club wallet; no further hand is dealt.
func TestCloseMidHandCashesOutAfterTheHand(t *testing.T) {
	doc := loadRealtimeSpec(t)
	e := newEnv(t, "alice", "bob")
	a := e.start("node-1", fast)
	sub, _, _, err := a.Subscribe(e.ctx, -1, 4096)
	if err != nil {
		t.Fatal(err)
	}
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 700)
	waitFor(t, "hand", 5*time.Second, func() bool { s := e.snapshot(a, ""); return s.Hand != nil && s.Hand.ToActSeat != 0 })
	handNo := e.snapshot(a, "").Hand.HandNo

	e.closeInDirectory()
	res, err := a.Close(e.ctx)
	if err != nil || res.Status != "CLOSING" || res.Seated != 2 {
		t.Fatalf("close mid-hand: %+v %v", res, err)
	}
	e.playHandToEnd(a, passive)
	e.waitEmpty(a)
	time.Sleep(100 * time.Millisecond) // > HandInterval: nothing else may start
	if h := e.snapshot(a, "").Hand; h != nil && h.HandNo != handNo {
		t.Fatalf("a new hand (%d) started on a closed table", h.HandNo)
	}
	e.assertClosedAndSettled(a, "alice", "bob")

	again, err := a.Close(e.ctx)
	if err != nil || again.Status != "CLOSED" {
		t.Fatalf("close is idempotent: %+v %v", again, err)
	}

	var closed, left int
	for drained := false; !drained; {
		select {
		case ev := <-sub.C:
			validate(t, doc, "TableEventPayload", ev.Public)
			switch ev.Kind {
			case table.KindTableClosed:
				closed++
			case table.KindPlayerLeft:
				left++
			}
		default:
			drained = true
		}
	}
	if closed != 1 || left != 2 {
		t.Fatalf("expected one TABLE_CLOSED and two PLAYER_LEFT, got %d and %d", closed, left)
	}
}

// The control plane's notification is lost: the actor still converges by
// re-reading the directory status before dealing the next hand.
func TestClosureConvergesWithoutNotification(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	a := e.start("node-1", fast)
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	waitFor(t, "hand", 5*time.Second, func() bool { s := e.snapshot(a, ""); return s.Hand != nil && s.Hand.ToActSeat != 0 })
	e.closeInDirectory()
	e.playHandToEnd(a, passive)
	e.waitEmpty(a)
	e.assertClosedAndSettled(a, "alice", "bob")
}

// A table closed while its actor was down is settled as soon as an actor
// starts for it again (e.g. after a crash or on another node).
func TestClosedTableIsSettledOnStart(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	slow := fast
	slow.StartDelay = time.Hour // no hand starts
	a := e.start("node-1", slow)
	e.sit(a, "alice", 1, 400)
	e.sit(a, "bob", 2, 900)
	a.Stop(errors.New("simulated crash"))
	<-a.Done()
	e.closeInDirectory()

	b := e.start("node-1", slow)
	e.waitEmpty(b)
	e.assertClosedAndSettled(b, "alice", "bob")
}
