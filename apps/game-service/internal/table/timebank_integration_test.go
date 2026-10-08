//go:build integration

package table_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/bar1287/kofclub/apps/game-service/internal/table"
)

// eventStream reads a subscription's public payloads in order.
type eventStream struct {
	t   *testing.T
	sub *table.Subscription
}

// next returns the next event of kind (skipping others) decoded as a map.
func (s eventStream) next(kind string, within time.Duration) map[string]any {
	s.t.Helper()
	deadline := time.After(within)
	for {
		select {
		case ev := <-s.sub.C:
			if ev.Kind != kind {
				continue
			}
			var m map[string]any
			if err := json.Unmarshal(ev.Public, &m); err != nil {
				s.t.Fatal(err)
			}
			return m
		case <-deadline:
			s.t.Fatalf("no %s within %v", kind, within)
			return nil
		}
	}
}

func ms(v any) int64 { f, _ := v.(float64); return int64(f) }

func (e *env) seatBank(name string) int64 {
	e.t.Helper()
	var bank int64
	if err := e.pool.QueryRow(e.ctx, `SELECT time_bank_ms FROM table_seats WHERE table_id = $1 AND user_id = $2`,
		e.tableID, e.users[name]).Scan(&bank); err != nil {
		e.t.Fatal(err)
	}
	return bank
}

// The time bank (roadmap W1.2) runs only after the turn timer: a player who
// acts within it keeps the rest, one who lets it run out loses all of it
// and gets the default action, and every hand dealt in refills it up to the
// table's bank. Remaining banks are persisted with the seat.
func TestTimeBankRunsAfterTheTurnTimerAndRefills(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	e.exec(`UPDATE tables SET time_bank_ms = 600, time_bank_refill_ms = 200 WHERE id = $1`, e.tableID)
	timing := fast
	timing.ActionTimeout = 150 * time.Millisecond
	timing.MaxTimeouts = 100 // this test is about the bank, not automatic sit-out
	a := e.start("node-1", timing)
	sub, _, _, err := a.Subscribe(e.ctx, -1, 4096)
	if err != nil {
		t.Fatal(err)
	}
	events := eventStream{t: t, sub: sub}
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	if e.seatBank("alice") != 600 || e.seatBank("bob") != 600 {
		t.Fatalf("new seats get the full bank: alice=%d bob=%d", e.seatBank("alice"), e.seatBank("bob"))
	}
	if info := e.snapshot(a, "").Table; info.TimeBankMs != 600 || info.TimeBankRefillMs != 200 {
		t.Fatalf("table info: %+v", info)
	}

	// The first actor lets the turn timer run out, then acts on the bank.
	first := events.next(table.KindTurnStarted, 5*time.Second)
	firstSeat := int(ms(first["seat"]))
	if ms(first["timeBankMs"]) != 600 {
		t.Fatalf("TURN_STARTED bank: %v", first["timeBankMs"])
	}
	bank := events.next(table.KindTimeBankStarted, 2*time.Second)
	if int(ms(bank["seat"])) != firstSeat || ms(bank["timeoutMs"]) != 600 {
		t.Fatalf("TIME_BANK_STARTED: %v", bank)
	}
	s := e.snapshot(a, "")
	if !s.Hand.UsingTimeBank || s.Hand.ToActSeat != firstSeat {
		t.Fatalf("snapshot during the bank: %+v", s.Hand)
	}
	time.Sleep(100 * time.Millisecond)
	if _, err := e.actOnce(a, passive); err != nil {
		t.Fatal(err)
	}
	acted := events.next(table.KindPlayerActed, 2*time.Second)
	firstLeft := ms(acted["timeBankMs"])
	if int(ms(acted["seat"])) != firstSeat || acted["timeout"] != false || firstLeft < 50 || firstLeft > 500 {
		t.Fatalf("acting on the bank keeps the rest: %v", acted)
	}
	firstName := e.nameOf(e.seatUser(s, firstSeat))
	if got := e.seatBank(firstName); got != firstLeft {
		t.Fatalf("persisted bank %d, event says %d", got, firstLeft)
	}

	// The second actor lets both the timer and the whole bank run out.
	second := events.next(table.KindTurnStarted, 2*time.Second)
	secondSeat := int(ms(second["seat"]))
	if secondSeat == firstSeat || ms(second["timeBankMs"]) != 600 {
		t.Fatalf("second turn: %v", second)
	}
	if b := events.next(table.KindTimeBankStarted, 2*time.Second); int(ms(b["seat"])) != secondSeat {
		t.Fatalf("second bank: %v", b)
	}
	timedOut := events.next(table.KindPlayerActed, 3*time.Second)
	if int(ms(timedOut["seat"])) != secondSeat || timedOut["timeout"] != true || ms(timedOut["timeBankMs"]) != 0 {
		t.Fatalf("an expired bank is used up: %v", timedOut)
	}
	secondName := e.nameOf(e.seatUser(s, secondSeat))
	if got := e.seatBank(secondName); got != 0 {
		t.Fatalf("persisted bank after expiry: %d", got)
	}

	// Finish the hand: the first player acts at once, the second (no bank
	// left) times out on the turn timer alone.
	for {
		s := e.snapshot(a, "")
		if s.Hand == nil || s.Hand.HandNo != 1 || s.Hand.ToActSeat == 0 {
			break
		}
		if s.Hand.ToActSeat == firstSeat {
			_, _ = e.actOnce(a, passive)
		}
		time.Sleep(10 * time.Millisecond)
	}

	// The next hand refills both banks: +200 each, capped at 600.
	started := events.next(table.KindHandStarted, 5*time.Second)
	if ms(started["handNo"]) != 2 {
		started = events.next(table.KindHandStarted, 5*time.Second)
	}
	banks := map[int]int64{}
	for _, p := range started["players"].([]any) {
		pm := p.(map[string]any)
		banks[int(ms(pm["seat"]))] = ms(pm["timeBankMs"])
	}
	if banks[secondSeat] != 200 || banks[firstSeat] != min(firstLeft+200, 600) {
		t.Fatalf("refills after hand 1 (first left %d): %v", firstLeft, banks)
	}
	e.assertChipsConsistent()
}

// A table without a time bank applies the default action as soon as the
// turn timer runs out.
func TestNoTimeBankActsAtTheTurnTimer(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	e.exec(`UPDATE tables SET time_bank_ms = 0 WHERE id = $1`, e.tableID)
	timing := fast
	timing.ActionTimeout = 150 * time.Millisecond
	a := e.start("node-1", timing)
	sub, _, _, err := a.Subscribe(e.ctx, -1, 4096)
	if err != nil {
		t.Fatal(err)
	}
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	turn := eventStream{t: t, sub: sub}.next(table.KindTurnStarted, 5*time.Second)
	if ms(turn["timeBankMs"]) != 0 {
		t.Fatalf("no bank expected: %v", turn)
	}
	start := time.Now()
	for {
		select {
		case ev := <-sub.C:
			if ev.Kind == table.KindTimeBankStarted {
				t.Fatal("a table without a time bank must not start one")
			}
			if ev.Kind == table.KindPlayerActed {
				if time.Since(start) > time.Second {
					t.Fatalf("default action came late: %v", time.Since(start))
				}
				return
			}
		case <-time.After(3 * time.Second):
			t.Fatal("no default action")
		}
	}
}
