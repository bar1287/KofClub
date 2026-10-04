//go:build integration

package table_test

import (
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/bar1287/kofclub/apps/game-service/internal/history"
	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/go/poker"
)

// A PLO table deals four private hole cards, offers pot-limit sizing,
// records the game on the hand, survives failover by replay, and serves the
// participant's four cards in history once the hand is over.
func TestPLOTableDealsFourCardsAndResumesByReplay(t *testing.T) {
	doc := loadRealtimeSpec(t)
	e := newEnv(t, "alice", "bob", "carol")
	e.setGame(poker.GamePLO)
	a := e.start("node-1", fast)
	sub, _, _, err := a.Subscribe(e.ctx, -1, 8192)
	if err != nil {
		t.Fatal(err)
	}
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	e.sit(a, "carol", 3, 1000)
	waitFor(t, "hand", 5*time.Second, func() bool { s := e.snapshot(a, ""); return s.Hand != nil && s.Hand.ToActSeat != 0 })

	pub := e.snapshot(a, "")
	if pub.Table.GameType != "PLO" || pub.You != nil {
		t.Fatalf("spectator snapshot: game %q you %+v", pub.Table.GameType, pub.You)
	}
	dealt := map[string][]poker.Card{}
	for _, n := range []string{"alice", "bob", "carol"} {
		mine := e.snapshot(a, e.users[n])
		if len(mine.You.HoleCards) != 4 {
			t.Fatalf("%s sees %d hole cards", n, len(mine.You.HoleCards))
		}
		dealt[n] = mine.You.HoleCards
	}

	// Pot limit: three-handed 5/10, the first actor may raise to at most 35.
	actor := e.seatUser(pub, pub.Hand.ToActSeat)
	las := e.snapshot(a, actor).You.LegalActions
	var raise poker.LegalAction
	for _, la := range las {
		if la.Kind == poker.ActionRaise {
			raise = la
		}
		if la.Kind == poker.ActionAllIn {
			t.Fatalf("all-in above the pot limit offered: %+v", las)
		}
	}
	if raise.MinTo != 20 || raise.MaxTo != 35 {
		t.Fatalf("pot-limit raise bounds %+v", raise)
	}
	if _, err := e.actOnce(a, func([]poker.LegalAction) (string, int64) { return "RAISE", 36 }); err == nil {
		t.Fatal("raise above the pot limit accepted")
	}
	if _, err := e.actOnce(a, func([]poker.LegalAction) (string, int64) { return "RAISE", 35 }); err != nil {
		t.Fatal(err)
	}
	if _, err := e.actOnce(a, passive); err != nil {
		t.Fatal(err)
	}
	before := e.snapshot(a, e.users["alice"])

	// Crash and fail over: the hand is rebuilt as PLO from the stored record.
	a.Stop(errors.New("simulated crash"))
	<-a.Done()
	e.exec(`UPDATE table_leases SET expires_at = now() - interval '1 second' WHERE table_id = $1`, e.tableID)
	b := e.start("node-2", fast)
	after := e.snapshot(b, e.users["alice"])
	if after.Hand == nil || after.Hand.HandID != before.Hand.HandID || after.Hand.Pot != before.Hand.Pot ||
		after.Hand.ToActSeat != before.Hand.ToActSeat || after.Table.GameType != "PLO" ||
		poker.CardsString(after.You.HoleCards) != poker.CardsString(before.You.HoleCards) {
		t.Fatalf("resumed hand differs:\nbefore %+v %v\nafter  %+v %v", before.Hand, before.You, after.Hand, after.You)
	}

	handID := before.Hand.HandID
	e.playHandToEnd(b, passive)
	waitFor(t, "settled", 3*time.Second, func() bool {
		var st string
		_ = e.pool.QueryRow(e.ctx, `SELECT status FROM hands WHERE id = $1`, handID).Scan(&st)
		return st == "COMPLETED"
	})
	e.assertChipsConsistent()
	var game string
	_ = e.pool.QueryRow(e.ctx, `SELECT game_type FROM hands WHERE id = $1`, handID).Scan(&game)
	if game != "PLO" {
		t.Fatalf("hand game_type = %q", game)
	}

	// History: the participant's own four cards, decrypted by the game plane.
	reader := history.NewReader(store.New(e.pool, "reader"), e.seal)
	cards, err := reader.OwnHoleCards(e.ctx, handID, e.users["alice"])
	if err != nil || !slices.Equal(cards, dealt["alice"]) {
		t.Fatalf("history hole cards %v (%v), dealt %v", cards, err, dealt["alice"])
	}

	// Every event the first node emitted matches the contract; HAND_STARTED
	// carries the game; the public stream never contains hole cards.
	var started bool
	for drained := false; !drained; {
		select {
		case ev, ok := <-sub.C:
			if !ok {
				drained = true
				continue
			}
			validate(t, doc, "TableEventPayload", ev.Public)
			for _, p := range ev.Private {
				validate(t, doc, "TableEventPayload", p)
			}
			if ev.Kind == "HAND_STARTED" && ev.HandID == handID {
				var hs struct {
					GameType string `json:"gameType"`
				}
				_ = json.Unmarshal(ev.Public, &hs)
				started = hs.GameType == "PLO"
			}
			if ev.Kind == "HOLE_CARDS_DEALT" {
				for user, p := range ev.Private {
					var hc struct {
						Cards []poker.Card `json:"cards"`
					}
					_ = json.Unmarshal(p, &hc)
					if len(hc.Cards) != 4 {
						t.Fatalf("private hole cards for %s: %s", user, p)
					}
				}
				var pubHC map[string]any
				_ = json.Unmarshal(ev.Public, &pubHC)
				if _, leaked := pubHC["cards"]; leaked {
					t.Fatalf("public hole-card event leaks cards: %s", ev.Public)
				}
			}
		default:
			drained = true
		}
	}
	if !started {
		t.Fatal("HAND_STARTED with gameType PLO not observed")
	}
	snap, _ := json.Marshal(e.snapshot(b, e.users["bob"]))
	validate(t, doc, "TableSnapshot", snap)
}
