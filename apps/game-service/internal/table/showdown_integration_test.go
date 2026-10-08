//go:build integration

package table_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/bar1287/kofclub/apps/game-service/internal/table"
)

// Showdown choices (roadmap W1.5): players muck losing hands by default
// (a persisted per-seat preference); a mucked hand stays private in the
// snapshot, the hand record and the event log; after the hand, cards can be
// shown one at a time until the next hand starts.
func TestMuckedHandsStayPrivateAndCanBeShownAfterTheHand(t *testing.T) {
	e := newEnv(t, "alice", "bob")
	timing := fast
	timing.HandInterval = 1500 * time.Millisecond // the window to show cards
	a := e.start("node-1", timing)
	e.sit(a, "alice", 1, 1000)

	if you := e.snapshot(a, e.users["alice"]).You; !you.MuckLosingHands {
		t.Fatalf("losing hands are mucked by default: %+v", you)
	}
	if on, err := a.SetMuckLosing(e.ctx, e.users["alice"], false); err != nil || on {
		t.Fatalf("turn off: %v %v", on, err)
	}
	var stored bool
	_ = e.pool.QueryRow(e.ctx, `SELECT muck_losing FROM table_seats WHERE table_id = $1 AND user_id = $2`, e.tableID, e.users["alice"]).Scan(&stored)
	if stored || e.snapshot(a, e.users["alice"]).You.MuckLosingHands {
		t.Fatal("the preference is stored and in the snapshot")
	}
	if _, err := a.SetMuckLosing(e.ctx, e.users["alice"], true); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SetMuckLosing(e.ctx, uuid.NewString(), true); errCode(err) != "PLAYER_NOT_SEATED" {
		t.Fatalf("not seated: %v", err)
	}

	e.sit(a, "bob", 2, 1000)
	waitFor(t, "hand start", 5*time.Second, func() bool {
		s := e.snapshot(a, "")
		return s.Hand != nil && s.Hand.ToActSeat != 0
	})
	show := func(name string, cards ...string) (table.CommandResult, error) {
		return a.Command(e.ctx, table.CommandRequest{UserID: e.users[name], CommandID: uuid.NewString(), Kind: "SHOW_CARDS", Cards: cards, ReceivedAt: time.Now()})
	}
	if _, err := show("alice", "As"); errCode(err) != "ILLEGAL_ACTION" {
		t.Fatalf("showing during the hand: %v", err)
	}

	// Heads-up checked down: the second hand at showdown is mucked when it
	// loses. Play until that happens.
	var mucker, winner string
	var snap table.Snapshot
	for i := 0; i < 15 && mucker == ""; i++ {
		e.playHandToEnd(a, passive)
		snap = e.snapshot(a, "")
		for _, s := range snap.Seats {
			if s.Mucked {
				mucker = e.nameOf(s.UserID)
			} else if len(s.ShownCards) > 0 {
				winner = e.nameOf(s.UserID)
			}
		}
	}
	if mucker == "" || winner == "" {
		t.Fatal("no losing hand was mucked in 15 showdowns")
	}
	handID := snap.Hand.HandID
	for _, s := range snap.Seats {
		if s.Mucked && len(s.ShownCards) > 0 {
			t.Fatalf("a mucked hand is not public: %+v", s)
		}
	}
	var muckedShown []byte
	_ = e.pool.QueryRow(e.ctx, `SELECT shown_cards FROM hand_players WHERE hand_id = $1 AND user_id = $2`, handID, e.users[mucker]).Scan(&muckedShown)
	if muckedShown != nil {
		t.Fatalf("the hand record keeps a mucked hand private: %s", muckedShown)
	}
	var mucks int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM game_events WHERE hand_id = $1 AND event_type = 'CARDS_MUCKED'`, handID).Scan(&mucks)
	if mucks != 1 {
		t.Fatalf("CARDS_MUCKED events: %d", mucks)
	}

	// The loser shows one card, then cannot show it again; the winner's
	// cards were already shown.
	hole := e.snapshot(a, e.users[mucker]).You.HoleCards
	if len(hole) != 2 {
		t.Fatalf("the hand that just ended is still the viewer's: %v", hole)
	}
	first := hole[0].String()
	req := table.CommandRequest{UserID: e.users[mucker], CommandID: uuid.NewString(), Kind: "SHOW_CARDS", Cards: []string{first}, ReceivedAt: time.Now()}
	res, err := a.Command(e.ctx, req)
	if err != nil || !res.Accepted {
		t.Fatalf("show one card: %+v %v", res, err)
	}
	if again, err := a.Command(e.ctx, req); err != nil || !again.Duplicate {
		t.Fatalf("a retried show is a duplicate: %+v %v", again, err)
	}
	if _, err := show(mucker, first); errCode(err) != "ILLEGAL_ACTION" {
		t.Fatalf("showing a card twice: %v", err)
	}
	if _, err := show(winner, "As"); errCode(err) != "ILLEGAL_ACTION" {
		t.Fatalf("cards shown at showdown: %v", err)
	}
	if _, err := show(mucker, "Zz"); errCode(err) != "VALIDATION_FAILED" {
		t.Fatalf("bad card: %v", err)
	}
	for _, s := range e.snapshot(a, "").Seats {
		if e.nameOf(s.UserID) == mucker && (len(s.ShownCards) != 1 || s.ShownCards[0].String() != first) {
			t.Fatalf("the shown card is public: %+v", s)
		}
	}
	var payload []byte
	if err := e.pool.QueryRow(e.ctx, `SELECT payload_json FROM game_events WHERE hand_id = $1 AND event_type = 'CARDS_SHOWN'`, handID).Scan(&payload); err != nil {
		t.Fatalf("CARDS_SHOWN is recorded with the hand: %v", err)
	}
	doc := loadRealtimeSpec(t)
	validate(t, doc, "TableEventPayload", payload)
	var muckPayload []byte
	_ = e.pool.QueryRow(e.ctx, `SELECT payload_json FROM game_events WHERE hand_id = $1 AND event_type = 'CARDS_MUCKED'`, handID).Scan(&muckPayload)
	validate(t, doc, "TableEventPayload", muckPayload)
	snapJSON, _ := json.Marshal(e.snapshot(a, e.users[mucker]))
	validate(t, doc, "TableSnapshot", snapJSON)
	var ev struct {
		UserID string   `json:"userId"`
		Cards  []string `json:"cards"`
	}
	_ = json.Unmarshal(payload, &ev)
	if ev.UserID != e.users[mucker] || len(ev.Cards) != 1 || ev.Cards[0] != first {
		t.Fatalf("CARDS_SHOWN payload: %s", payload)
	}
	e.assertChipsConsistent()
}
