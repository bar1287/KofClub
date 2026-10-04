//go:build integration

package table_test

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	mrand "math/rand/v2"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/bar1287/kofclub/apps/game-service/internal/lease"
	"github.com/bar1287/kofclub/apps/game-service/internal/sealer"
	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/apps/game-service/internal/table"
	ledger "github.com/bar1287/kofclub/go/ledger-client"
	"github.com/bar1287/kofclub/go/pgtest"
	"github.com/bar1287/kofclub/go/poker"
)

type env struct {
	t       *testing.T
	ctx     context.Context
	pool    *pgxpool.Pool
	seal    *sealer.Sealer
	clubID  string
	tableID string
	users   map[string]string // name -> id
	granted int64
}

func newEnv(t *testing.T, names ...string) *env {
	t.Helper()
	pool, _ := pgtest.NewPool(t)
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	seal, err := sealer.New(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, ctx: context.Background(), pool: pool, seal: seal, users: map[string]string{}}
	for _, n := range names {
		id := uuid.NewString()
		e.exec(`INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, 'x')`, id, n+"@example.test", n)
		e.users[n] = id
	}
	e.clubID = uuid.NewString()
	e.exec(`INSERT INTO clubs (id, owner_user_id, name, join_code) VALUES ($1, $2, 'Club', $3)`, e.clubID, e.users[names[0]], e.clubID[:8])
	e.tableID = uuid.NewString()
	e.exec(`INSERT INTO tables (id, club_id, name, max_seats, small_blind, big_blind, buyin_min, buyin_max, created_by)
	        VALUES ($1, $2, 'Test Table', 6, 5, 10, 100, 2000, $3)`, e.tableID, e.clubID, e.users[names[0]])
	treasury, err := ledger.EnsureAccount(e.ctx, pool, e.clubID, ledger.AccountClubTreasury, e.clubID, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range names {
		wallet, _ := ledger.EnsureAccount(e.ctx, pool, e.clubID, ledger.AccountMemberWallet, e.users[n], "")
		if _, err := ledger.Post(e.ctx, pool, ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM", ClubID: e.clubID,
			ExternalRef: "grant:" + n, Entries: []ledger.Entry{{AccountID: treasury, Amount: -5000}, {AccountID: wallet, Amount: 5000}}}); err != nil {
			t.Fatal(err)
		}
		e.granted += 5000
	}
	return e
}

// setGame changes the table's game (before an actor loads it).
func (e *env) setGame(game poker.GameType) {
	e.exec(`UPDATE tables SET game_type = $2 WHERE id = $1`, e.tableID, string(game))
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.pool.Exec(e.ctx, sql, args...); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
}

func (e *env) deps(nodeID string, rng io.Reader, timing table.Timing) table.Deps {
	return table.Deps{
		Store: store.New(e.pool, nodeID), Sealer: e.seal,
		Log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
		Metrics: table.NewMetrics(prometheus.NewRegistry()),
		Rand:    rng, Timing: timing,
	}
}

var fast = table.Timing{StartDelay: 20 * time.Millisecond, HandInterval: 30 * time.Millisecond, RetryBackoff: 50 * time.Millisecond, MaxTimeouts: 2, ActionTimeout: 10 * time.Second}

// start acquires the lease as nodeID and starts an actor.
func (e *env) start(nodeID string, timing table.Timing) *table.Actor {
	e.t.Helper()
	l, err := lease.NewManager(e.pool, nodeID, "http://"+nodeID, 10*time.Second).Acquire(e.ctx, e.tableID)
	if err != nil {
		e.t.Fatal(err)
	}
	a, err := table.Start(e.ctx, e.deps(nodeID, rand.Reader, timing), e.tableID, l.Epoch)
	if err != nil {
		e.t.Fatal(err)
	}
	e.t.Cleanup(func() { a.Stop(nil); <-a.Done() })
	return a
}

func (e *env) sit(a *table.Actor, name string, seat int, buyIn int64) table.SitResult {
	e.t.Helper()
	r, err := a.Sit(e.ctx, table.SitRequest{UserID: e.users[name], SeatNo: seat, BuyIn: buyIn, RequestID: "sit-" + name + "-" + uuid.NewString()})
	if err != nil {
		e.t.Fatalf("sit %s: %v", name, err)
	}
	return r
}

func waitFor(t *testing.T, what string, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func (e *env) snapshot(a *table.Actor, viewer string) table.Snapshot {
	e.t.Helper()
	s, err := a.Snapshot(e.ctx, viewer)
	if err != nil {
		e.t.Fatal(err)
	}
	return s
}

func (e *env) nameOf(id string) string {
	for n, u := range e.users {
		if u == id {
			return n
		}
	}
	return id
}

func (e *env) seatUser(s table.Snapshot, seat int) string {
	for _, v := range s.Seats {
		if v.Seat == seat {
			return v.UserID
		}
	}
	return ""
}

// actOnce makes the current actor take an action chosen by pick (from their
// own legal actions as provided by their private snapshot).
func (e *env) actOnce(a *table.Actor, pick func([]poker.LegalAction) (string, int64)) (table.CommandResult, error) {
	e.t.Helper()
	pub := e.snapshot(a, "")
	if pub.Hand == nil || pub.Hand.ToActSeat == 0 {
		return table.CommandResult{}, errors.New("no actor")
	}
	user := e.seatUser(pub, pub.Hand.ToActSeat)
	mine := e.snapshot(a, user)
	kind, amount := pick(mine.You.LegalActions)
	seq := mine.Seq
	return a.Command(e.ctx, table.CommandRequest{UserID: user, CommandID: uuid.NewString(), ExpectedSeq: &seq, Kind: kind, Amount: amount, ReceivedAt: time.Now()})
}

func passive(las []poker.LegalAction) (string, int64) {
	for _, la := range las {
		if la.Kind == poker.ActionCheck {
			return "CHECK", 0
		}
	}
	return "CALL", 0
}

// playHandToEnd drives the current hand to completion and returns its hand no.
func (e *env) playHandToEnd(a *table.Actor, pick func([]poker.LegalAction) (string, int64)) int64 {
	e.t.Helper()
	var handNo int64
	waitFor(e.t, "hand start", 5*time.Second, func() bool {
		s := e.snapshot(a, "")
		if s.Hand != nil && s.Hand.ToActSeat != 0 {
			handNo = s.Hand.HandNo
			return true
		}
		return false
	})
	for i := 0; i < 200; i++ {
		s := e.snapshot(a, "")
		if s.Hand == nil || s.Hand.HandNo != handNo || s.Hand.ToActSeat == 0 {
			return handNo
		}
		if _, err := e.actOnce(a, pick); err != nil {
			var te *table.Error
			if errors.As(err, &te) && (te.Code == "STALE_GAME_STATE" || te.Code == "HAND_NOT_ACTIVE" || te.Code == "NOT_YOUR_TURN") {
				continue // raced with a timer/hand transition
			}
			e.t.Fatalf("action failed: %v", err)
		}
	}
	e.t.Fatal("hand did not finish")
	return 0
}

// assertChipsConsistent checks ledger invariants, seat/ledger agreement and
// global conservation of the granted chips.
func (e *env) assertChipsConsistent() {
	e.t.Helper()
	v, err := ledger.Violations(e.ctx, e.pool)
	if err != nil || len(v) != 0 {
		e.t.Fatalf("ledger violations: %+v %v", v, err)
	}
	var total int64
	if err := e.pool.QueryRow(e.ctx, `SELECT coalesce(sum(balance), 0)::bigint FROM ledger_accounts WHERE club_id = $1 AND kind <> 'CLUB_TREASURY'`, e.clubID).Scan(&total); err != nil {
		e.t.Fatal(err)
	}
	if total != e.granted {
		e.t.Fatalf("chips not conserved: %d in accounts, %d granted", total, e.granted)
	}
	var mismatches int
	_ = e.pool.QueryRow(e.ctx, `
		SELECT count(*) FROM table_seats s
		  JOIN ledger_accounts a ON a.table_id = s.table_id AND a.owner_id = s.user_id AND a.kind = 'TABLE_STACK'
		 WHERE s.table_id = $1 AND s.stack_cached <> a.balance`, e.tableID).Scan(&mismatches)
	if mismatches != 0 {
		e.t.Fatalf("%d seats disagree with ledger table stacks", mismatches)
	}
}

func (e *env) walletBalance(name string) int64 {
	var b int64
	_ = e.pool.QueryRow(e.ctx, `SELECT balance FROM ledger_accounts WHERE club_id = $1 AND kind = 'MEMBER_WALLET' AND owner_id = $2`, e.clubID, e.users[name]).Scan(&b)
	return b
}

func TestFullHeadsUpHandIsPersistedAndSettled(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	a := e.start("node-1", fast)
	sub, _, _, err := a.Subscribe(e.ctx, -1, 1024)
	if err != nil {
		t.Fatal(err)
	}
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 4, 800)
	if e.walletBalance("alice") != 4000 || e.walletBalance("bob") != 4200 {
		t.Fatal("buy-ins must move chips from wallets to table stacks")
	}

	// Private data: the HOLE_CARDS_DEALT event exposes cards only to their owner.
	var hole table.Event
	waitFor(t, "hole cards", 5*time.Second, func() bool {
		for {
			select {
			case ev := <-sub.C:
				if ev.Kind == table.KindHoleCards {
					hole = ev
					return true
				}
			default:
				return false
			}
		}
	})
	if strings.Contains(string(hole.Public), "cards\"") {
		t.Fatalf("public hole-card event leaks cards: %s", hole.Public)
	}
	aliceView, bobView := string(hole.For(e.users["alice"])), string(hole.For(e.users["bob"]))
	if !strings.Contains(aliceView, "\"cards\"") || aliceView == bobView {
		t.Fatalf("private payloads wrong: %s / %s", aliceView, bobView)
	}
	snapBob := e.snapshot(a, e.users["bob"])
	snapAlice := e.snapshot(a, e.users["alice"])
	if len(snapBob.You.HoleCards) != 2 || len(snapAlice.You.HoleCards) != 2 ||
		poker.CardsString(snapBob.You.HoleCards) == poker.CardsString(snapAlice.You.HoleCards) {
		t.Fatal("each player must see exactly their own two cards")
	}
	for _, s := range snapBob.Seats {
		if s.ShownCards != nil {
			t.Fatal("no cards may be shown before showdown")
		}
	}

	handNo := e.playHandToEnd(a, passive)
	waitFor(t, "settlement", 3*time.Second, func() bool {
		var status string
		_ = e.pool.QueryRow(e.ctx, `SELECT status FROM hands WHERE table_id = $1 AND hand_no = $2`, e.tableID, handNo).Scan(&status)
		return status == "COMPLETED"
	})
	e.assertChipsConsistent()

	// Durable records: contiguous event sequence, no hole cards in the public log.
	var minSeq, maxSeq, count int64
	_ = e.pool.QueryRow(e.ctx, `SELECT min(seq), max(seq), count(*) FROM game_events WHERE table_id = $1`, e.tableID).Scan(&minSeq, &maxSeq, &count)
	if minSeq != 1 || maxSeq != count {
		t.Fatalf("event sequence not contiguous: min %d max %d count %d", minSeq, maxSeq, count)
	}
	var leaked int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM game_events WHERE table_id = $1 AND event_type = 'HOLE_CARDS_DEALT' AND payload_json ? 'cards'`, e.tableID).Scan(&leaked)
	if leaked != 0 {
		t.Fatal("hole cards persisted in the public event log")
	}
	var settled int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM ledger_transactions t JOIN hands h ON t.external_ref = 'hand:' || h.id::text WHERE h.table_id = $1`, e.tableID).Scan(&settled)
	var nets int64
	_ = e.pool.QueryRow(e.ctx, `SELECT coalesce(sum(net), 0) FROM hand_players hp JOIN hands h ON h.id = hp.hand_id WHERE h.table_id = $1`, e.tableID).Scan(&nets)
	if nets != 0 {
		t.Fatalf("hand nets do not sum to zero: %d", nets)
	}
	var commitment string
	_ = e.pool.QueryRow(e.ctx, `SELECT deck_commitment FROM hands WHERE table_id = $1 AND hand_no = $2`, e.tableID, handNo).Scan(&commitment)
	if len(commitment) != 64 {
		t.Fatalf("deck commitment missing: %q", commitment)
	}

	// The next hand starts automatically.
	waitFor(t, "next hand", 5*time.Second, func() bool {
		s := e.snapshot(a, "")
		return s.Hand != nil && s.Hand.HandNo == handNo+1
	})
}

func TestCommandIdempotencyAndValidation(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	a := e.start("node-1", fast)
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	waitFor(t, "hand", 5*time.Second, func() bool { s := e.snapshot(a, ""); return s.Hand != nil && s.Hand.ToActSeat != 0 })

	pub := e.snapshot(a, "")
	actor := e.seatUser(pub, pub.Hand.ToActSeat)
	other := e.users["alice"]
	if actor == other {
		other = e.users["bob"]
	}
	seq := pub.Seq

	_, err := a.Command(e.ctx, table.CommandRequest{UserID: other, CommandID: uuid.NewString(), Kind: "CALL", ReceivedAt: time.Now()})
	if !errors.Is(err, &table.Error{Code: "NOT_YOUR_TURN"}) {
		t.Fatalf("out of turn: %v", err)
	}
	_, err = a.Command(e.ctx, table.CommandRequest{UserID: actor, CommandID: uuid.NewString(), Kind: "CHECK", ReceivedAt: time.Now()})
	if !errors.Is(err, &table.Error{Code: "ILLEGAL_ACTION"}) {
		t.Fatalf("check facing a bet: %v", err)
	}
	stale := seq - 5
	_, err = a.Command(e.ctx, table.CommandRequest{UserID: actor, CommandID: uuid.NewString(), ExpectedSeq: &stale, Kind: "CALL", ReceivedAt: time.Now()})
	if !errors.Is(err, &table.Error{Code: "STALE_GAME_STATE"}) {
		t.Fatalf("stale expected seq: %v", err)
	}
	_, err = a.Command(e.ctx, table.CommandRequest{UserID: e.users["alice"], CommandID: uuid.NewString(), Kind: "DANCE", ReceivedAt: time.Now()})
	if !errors.Is(err, &table.Error{Code: "ILLEGAL_ACTION"}) {
		t.Fatalf("unknown kind: %v", err)
	}

	cmdID := uuid.NewString()
	first, err := a.Command(e.ctx, table.CommandRequest{UserID: actor, CommandID: cmdID, ExpectedSeq: &seq, Kind: "CALL", ReceivedAt: time.Now()})
	if err != nil || !first.Accepted {
		t.Fatalf("call: %+v %v", first, err)
	}
	after := e.snapshot(a, "")
	again, err := a.Command(e.ctx, table.CommandRequest{UserID: actor, CommandID: cmdID, ExpectedSeq: &seq, Kind: "CALL", ReceivedAt: time.Now()})
	if err != nil || !again.Duplicate || again.Seq != first.Seq {
		t.Fatalf("duplicate must return the original result: %+v %v", again, err)
	}
	if e.snapshot(a, "").Seq != after.Seq {
		t.Fatal("duplicate command changed state")
	}
	var n int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM table_commands WHERE command_id = $1`, cmdID).Scan(&n)
	if n != 1 {
		t.Fatalf("command persisted %d times", n)
	}
	// Another user reusing someone else's command id is rejected.
	if _, err := a.Command(e.ctx, table.CommandRequest{UserID: other, CommandID: cmdID, Kind: "CALL", ReceivedAt: time.Now()}); !errors.Is(err, &table.Error{Code: "ACTION_ALREADY_PROCESSED"}) {
		t.Fatalf("foreign duplicate: %v", err)
	}
}

func TestBuyInRules(t *testing.T) {
	e := newEnv(t, "alice", "bob", "carol")
	a := e.start("node-1", table.Timing{StartDelay: time.Hour, HandInterval: time.Hour, RetryBackoff: time.Second, MaxTimeouts: 2})
	cases := []struct {
		req  table.SitRequest
		code string
	}{
		{table.SitRequest{UserID: e.users["alice"], SeatNo: 1, BuyIn: 50, RequestID: "r1"}, "INVALID_BUY_IN"},
		{table.SitRequest{UserID: e.users["alice"], SeatNo: 1, BuyIn: 2001, RequestID: "r2"}, "INVALID_BUY_IN"},
		{table.SitRequest{UserID: e.users["alice"], SeatNo: 9, BuyIn: 500, RequestID: "r3"}, "VALIDATION_FAILED"},
	}
	for _, c := range cases {
		if _, err := a.Sit(e.ctx, c.req); !errors.Is(err, &table.Error{Code: c.code}) {
			t.Errorf("%+v: got %v want %s", c.req, err, c.code)
		}
	}
	res, err := a.Sit(e.ctx, table.SitRequest{UserID: e.users["alice"], SeatNo: 3, BuyIn: 500, RequestID: "ok-1"})
	if err != nil || res.SeatNo != 3 {
		t.Fatalf("sit: %+v %v", res, err)
	}
	if again, err := a.Sit(e.ctx, table.SitRequest{UserID: e.users["alice"], SeatNo: 3, BuyIn: 500, RequestID: "ok-1"}); err != nil || again.SeatNo != 3 {
		t.Fatalf("idempotent retry: %+v %v", again, err)
	}
	if e.walletBalance("alice") != 4500 {
		t.Fatalf("retry must not buy in twice: wallet %d", e.walletBalance("alice"))
	}
	if _, err := a.Sit(e.ctx, table.SitRequest{UserID: e.users["alice"], SeatNo: 4, BuyIn: 500, RequestID: "other"}); !errors.Is(err, &table.Error{Code: "ALREADY_SEATED"}) {
		t.Fatalf("second seat: %v", err)
	}
	if _, err := a.Sit(e.ctx, table.SitRequest{UserID: e.users["bob"], SeatNo: 3, BuyIn: 500, RequestID: "b1"}); err == nil {
		t.Fatal("seat taken must be rejected")
	}
	// Drain Carol's wallet so a buy-in exceeds her balance.
	e.sit(a, "carol", 5, 2000)
	r, err := a.Leave(e.ctx, e.users["carol"], "leave-1")
	if err != nil || r.Status != "LEFT" || r.CashOut != 2000 {
		t.Fatalf("leave: %+v %v", r, err)
	}
	carolWallet, _ := ledger.EnsureAccount(e.ctx, e.pool, e.clubID, ledger.AccountMemberWallet, e.users["carol"], "")
	treasury, _ := ledger.EnsureAccount(e.ctx, e.pool, e.clubID, ledger.AccountClubTreasury, e.clubID, "")
	if _, err := ledger.Post(e.ctx, e.pool, ledger.Posting{Kind: "CLUB_DEDUCTION", ActorType: "SYSTEM", ClubID: e.clubID, ExternalRef: "drain-carol",
		Entries: []ledger.Entry{{AccountID: carolWallet, Amount: -4900}, {AccountID: treasury, Amount: 4900}}}); err != nil {
		t.Fatal(err)
	}
	e.granted -= 4900
	if _, err := a.Sit(e.ctx, table.SitRequest{UserID: e.users["carol"], SeatNo: 5, BuyIn: 200, RequestID: "c2"}); !errors.Is(err, &table.Error{Code: "INSUFFICIENT_CHIPS"}) {
		t.Fatalf("insufficient chips: %v", err)
	}
	if s := e.snapshot(a, ""); len(s.Seats) != 1 {
		t.Fatalf("failed buy-in must not seat the player: %+v", s.Seats)
	}
	// A buy-in request id that was already used (the player has since left)
	// must never seat the player again without moving chips.
	if r, err := a.Leave(e.ctx, e.users["alice"], "alice-leave"); err != nil || r.CashOut != 500 {
		t.Fatalf("alice leave: %+v %v", r, err)
	}
	if _, err := a.Sit(e.ctx, table.SitRequest{UserID: e.users["alice"], SeatNo: 3, BuyIn: 500, RequestID: "ok-1"}); !errors.Is(err, &table.Error{Code: "ACTION_ALREADY_PROCESSED"}) {
		t.Fatalf("replayed buy-in request: %v", err)
	}
	if s := e.snapshot(a, ""); len(s.Seats) != 0 {
		t.Fatalf("nobody should be seated: %+v", s.Seats)
	}
	e.assertChipsConsistent()
}

func TestTimeoutsAutoActAndSitOut(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	timing := fast
	timing.ActionTimeout = 150 * time.Millisecond
	a := e.start("node-1", timing)
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	// Nobody acts: the server applies check/fold defaults; after two
	// consecutive timeouts a player is sat out and dealing stops.
	waitFor(t, "a player sat out by timeouts", 10*time.Second, func() bool {
		for _, s := range e.snapshot(a, "").Seats {
			if s.SittingOut {
				return true
			}
		}
		return false
	})
	waitFor(t, "table idle", 5*time.Second, func() bool {
		s := e.snapshot(a, "")
		return s.Hand == nil || s.Hand.ToActSeat == 0
	})
	var timeoutActs int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM game_events WHERE table_id = $1 AND event_type = 'PLAYER_ACTED' AND (payload_json->>'timeout')::boolean`, e.tableID).Scan(&timeoutActs)
	if timeoutActs == 0 {
		t.Fatal("timeout actions must be recorded")
	}
	e.assertChipsConsistent()
}

func TestLeavingMidHandCashesOutAfterTheHand(t *testing.T) {
	e := newEnv(t, "alice", "bob", "carol")
	a := e.start("node-1", fast)
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	e.sit(a, "carol", 3, 1000)
	waitFor(t, "hand", 5*time.Second, func() bool { s := e.snapshot(a, ""); return s.Hand != nil && s.Hand.ToActSeat != 0 })
	handNo := e.snapshot(a, "").Hand.HandNo
	r, err := a.Leave(e.ctx, e.users["carol"], "leave-mid")
	if err != nil || r.Status != "LEAVING_AFTER_HAND" {
		t.Fatalf("leave mid-hand: %+v %v", r, err)
	}
	e.playHandToEnd(a, passive)
	waitFor(t, "carol gone", 5*time.Second, func() bool {
		for _, s := range e.snapshot(a, "").Seats {
			if s.UserID == e.users["carol"] {
				return false
			}
		}
		return true
	})
	var carolStack int64
	_ = e.pool.QueryRow(e.ctx, `SELECT coalesce(balance, 0) FROM ledger_accounts WHERE kind = 'TABLE_STACK' AND owner_id = $1`, e.users["carol"]).Scan(&carolStack)
	if carolStack != 0 {
		t.Fatalf("carol's table stack should be cashed out, got %d", carolStack)
	}
	var cashOuts int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM ledger_transactions WHERE kind = 'TABLE_CASH_OUT' AND actor_user_id = $1`, e.users["carol"]).Scan(&cashOuts)
	if cashOuts != 1 {
		t.Fatalf("cash-outs = %d", cashOuts)
	}
	if e.snapshot(a, "").Hand.HandNo == handNo && e.snapshot(a, "").Hand.ToActSeat != 0 {
		t.Fatal("hand should have finished")
	}
	e.assertChipsConsistent()
}

// A node dies mid-hand; another node takes the lease (higher epoch),
// replays the persisted actions against the decrypted deck and continues
// the same hand. The old node can no longer write.
func TestFailoverResumesHandByReplay(t *testing.T) {
	e := newEnv(t, "alice", "bob", "carol")
	a := e.start("node-1", fast)
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	e.sit(a, "carol", 3, 1000)
	waitFor(t, "hand", 5*time.Second, func() bool { s := e.snapshot(a, ""); return s.Hand != nil && s.Hand.ToActSeat != 0 })
	raise := func(las []poker.LegalAction) (string, int64) {
		for _, la := range las {
			if la.Kind == poker.ActionRaise {
				return "RAISE", la.MinTo
			}
		}
		return passive(las)
	}
	if _, err := e.actOnce(a, raise); err != nil {
		t.Fatal(err)
	}
	if _, err := e.actOnce(a, passive); err != nil {
		t.Fatal(err)
	}
	before := e.snapshot(a, e.users["alice"])

	// Crash: the process stops without releasing its lease; the lease expires.
	a.Stop(errors.New("simulated crash"))
	<-a.Done()
	e.exec(`UPDATE table_leases SET expires_at = now() - interval '1 second' WHERE table_id = $1`, e.tableID)

	b := e.start("node-2", fast)
	after := e.snapshot(b, e.users["alice"])
	if after.Hand == nil || after.Hand.HandID != before.Hand.HandID || after.Hand.Pot != before.Hand.Pot ||
		after.Hand.Street != before.Hand.Street || after.Hand.ToActSeat != before.Hand.ToActSeat ||
		poker.CardsString(after.You.HoleCards) != poker.CardsString(before.You.HoleCards) {
		t.Fatalf("resumed hand differs:\nbefore %+v\nafter  %+v", before.Hand, after.Hand)
	}
	if after.Seq <= before.Seq {
		t.Fatal("sequence numbers must continue after failover")
	}

	// The old owner is fenced: a stale-epoch write is rejected by the store.
	err := store.New(e.pool, "node-1").InFencedTx(e.ctx, store.Fence{TableID: e.tableID, NodeID: "node-1", Epoch: a.Epoch()}, nil)
	if !errors.Is(err, store.ErrFenced) {
		t.Fatalf("stale owner write: %v", err)
	}

	e.playHandToEnd(b, passive)
	waitFor(t, "settled", 3*time.Second, func() bool {
		var n int
		_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM hands WHERE id = $1 AND status = 'COMPLETED'`, before.Hand.HandID).Scan(&n)
		return n == 1
	})
	e.assertChipsConsistent()
	var settlements int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM ledger_transactions WHERE external_ref = $1`, "hand:"+before.Hand.HandID).Scan(&settlements)
	if settlements > 1 {
		t.Fatal("hand settled twice")
	}
}

// If an unfinished hand cannot be replayed safely it is voided: no chips
// move and stacks return to their start-of-hand values.
func TestRecoveryVoidsUnreplayableHand(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	a := e.start("node-1", fast)
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	waitFor(t, "hand", 5*time.Second, func() bool { s := e.snapshot(a, ""); return s.Hand != nil && s.Hand.ToActSeat != 0 })
	if _, err := e.actOnce(a, passive); err != nil {
		t.Fatal(err)
	}
	handID := e.snapshot(a, "").Hand.HandID
	a.Stop(errors.New("crash"))
	<-a.Done()
	e.exec(`UPDATE table_leases SET expires_at = now() - interval '1 second' WHERE table_id = $1`, e.tableID)
	e.exec(`UPDATE hands SET deck_enc = '\x00' WHERE id = $1`, handID) // corrupt the encrypted deck

	b := e.start("node-2", table.Timing{StartDelay: time.Hour, HandInterval: time.Hour, RetryBackoff: time.Second, MaxTimeouts: 2})
	var status, reason string
	_ = e.pool.QueryRow(e.ctx, `SELECT status, coalesce(void_reason, '') FROM hands WHERE id = $1`, handID).Scan(&status, &reason)
	if status != "VOIDED" || reason != "RECOVERY_REPLAY_FAILED" {
		t.Fatalf("hand status %s (%s)", status, reason)
	}
	for _, s := range e.snapshot(b, "").Seats {
		if s.Stack != 1000 {
			t.Fatalf("stacks must return to start-of-hand values: %+v", s)
		}
	}
	var voided int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM game_events WHERE table_id = $1 AND event_type = 'HAND_VOIDED'`, e.tableID).Scan(&voided)
	if voided != 1 {
		t.Fatal("HAND_VOIDED event missing")
	}
	e.assertChipsConsistent()
}

func TestEventsSinceAndSubscriptionsAreOrdered(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	a := e.start("node-1", fast)
	sub, _, start, err := a.Subscribe(e.ctx, -1, 4096)
	if err != nil {
		t.Fatal(err)
	}
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	e.playHandToEnd(a, passive)
	evs, seq, err := a.EventsSince(e.ctx, start)
	if err != nil || len(evs) == 0 || evs[len(evs)-1].Seq != seq {
		t.Fatalf("events since: %d %d %v", len(evs), seq, err)
	}
	for i, ev := range evs {
		if ev.Seq != start+int64(i)+1 {
			t.Fatalf("gap at %d: %d", i, ev.Seq)
		}
	}
	got := 0
	timeout := time.After(2 * time.Second)
	for got < len(evs) {
		select {
		case ev := <-sub.C:
			if ev.Seq != evs[got].Seq {
				t.Fatalf("subscription order %d != %d", ev.Seq, evs[got].Seq)
			}
			got++
		case <-timeout:
			t.Fatalf("subscription delivered %d of %d", got, len(evs))
		}
	}
	if _, _, err := a.EventsSince(e.ctx, seq+10); !errors.Is(err, table.ErrResyncRequired) {
		t.Fatalf("future seq must require resync: %v", err)
	}
}

// Many hands with random (legal) play at a 3-player table: after every
// hand the ledger, seats and granted chips stay consistent.
func TestManyRandomHandsConserveChips(t *testing.T) {
	for _, game := range []poker.GameType{poker.GameNLHE, poker.GamePLO} {
		t.Run(string(game), func(t *testing.T) { playRandomHands(t, game) })
	}
}

func playRandomHands(t *testing.T, game poker.GameType) {
	e := newEnv(t, "alice", "bob", "carol")
	e.setGame(game)
	a := e.start("node-1", fast)
	for i, n := range []string{"alice", "bob", "carol"} {
		e.sit(a, n, i+1, 1000+int64(i)*300)
	}
	r := mrand.New(mrand.NewPCG(7, 8))
	random := func(las []poker.LegalAction) (string, int64) {
		byKind := map[poker.ActionKind]poker.LegalAction{}
		for _, la := range las {
			byKind[la.Kind] = la
		}
		switch roll := r.IntN(100); {
		case roll < 10:
			if _, ok := byKind[poker.ActionCheck]; !ok {
				return "FOLD", 0
			}
		case roll < 30:
			for _, k := range []poker.ActionKind{poker.ActionBet, poker.ActionRaise} {
				if la, ok := byKind[k]; ok {
					return string(k), la.MinTo + r.Int64N(min(la.MaxTo-la.MinTo, 2*la.MinTo)+1)
				}
			}
		case roll < 33:
			if _, ok := byKind[poker.ActionAllIn]; ok {
				return "ALL_IN", 0
			}
		}
		return passive(las)
	}
	for hand := 0; hand < 20; hand++ {
		s := e.snapshot(a, "")
		eligible := 0
		for _, seat := range s.Seats {
			if !seat.SittingOut && seat.Stack > 0 {
				eligible++
			}
		}
		if eligible < 2 {
			break
		}
		handNo := e.playHandToEnd(a, random)
		waitFor(t, fmt.Sprintf("hand %d settled", handNo), 3*time.Second, func() bool {
			var st string
			_ = e.pool.QueryRow(e.ctx, `SELECT status FROM hands WHERE table_id = $1 AND hand_no = $2`, e.tableID, handNo).Scan(&st)
			return st == "COMPLETED"
		})
		e.assertChipsConsistent()
	}
	var raw json.RawMessage
	_ = e.pool.QueryRow(e.ctx, `SELECT payload_json FROM game_events WHERE table_id = $1 AND event_type = 'HAND_COMPLETED' ORDER BY seq DESC LIMIT 1`, e.tableID).Scan(&raw)
	var completed, actions int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM hands WHERE table_id = $1 AND status = 'COMPLETED'`, e.tableID).Scan(&completed)
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM table_commands WHERE table_id = $1`, e.tableID).Scan(&actions)
	t.Logf("completed hands: %d, player commands: %d", completed, actions)
	if len(raw) == 0 || completed < 5 {
		t.Fatalf("expected at least 5 completed hands, got %d", completed)
	}
}
