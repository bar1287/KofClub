//go:build integration

package table_test

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"

	"github.com/bar1287/kofclub/apps/game-service/internal/table"
	"github.com/bar1287/kofclub/go/poker"
)

func loadRealtimeSpec(t *testing.T) *openapi3.T {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	path := filepath.Join(filepath.Dir(file), "../../../../packages/contracts/openapi/realtime.yaml")
	doc, err := openapi3.NewLoader().LoadFromFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

func validate(t *testing.T, doc *openapi3.T, schema string, payload []byte) {
	t.Helper()
	var v any
	if err := json.Unmarshal(payload, &v); err != nil {
		t.Fatal(err)
	}
	if err := doc.Components.Schemas[schema].Value.VisitJSON(v); err != nil {
		t.Fatalf("payload does not match realtime.yaml %s: %v\n%s", schema, err, payload)
	}
}

// Every event the actor emits (public and private variants) and every
// snapshot must match the published realtime contract (no drift).
func TestEventsAndSnapshotsMatchRealtimeContract(t *testing.T) {
	doc := loadRealtimeSpec(t)
	e := newEnv(t, "alice", "bob", "carol")
	a := e.start("node-1", fast)
	sub, _, _, err := a.Subscribe(e.ctx, -1, 8192)
	if err != nil {
		t.Fatal(err)
	}
	e.sit(a, "alice", 1, 1000)
	e.sit(a, "bob", 2, 1000)
	e.sit(a, "carol", 3, 300)
	allIn := func(las []poker.LegalAction) (string, int64) {
		for _, la := range las {
			if la.Kind == poker.ActionAllIn {
				return "ALL_IN", 0
			}
		}
		return passive(las)
	}
	e.playHandToEnd(a, allIn) // all-ins: side pots, showdown, reveals
	// Carol may already have busted (and been removed) after going all-in.
	if _, err := a.Leave(e.ctx, e.users["carol"], "carol-out"); err != nil && !errors.Is(err, &table.Error{Code: "PLAYER_NOT_SEATED"}) {
		t.Fatal(err)
	}
	if seats := e.snapshot(a, "").Seats; len(seats) > 0 {
		if _, err := a.SetSittingOut(e.ctx, seats[0].UserID, true); err != nil {
			t.Fatal(err)
		}
	}

	kinds := map[string]bool{}
	deadline := time.After(3 * time.Second)
	for done := false; !done; {
		select {
		case ev := <-sub.C:
			kinds[ev.Kind] = true
			validate(t, doc, "TableEventPayload", ev.Public)
			for _, p := range ev.Private {
				validate(t, doc, "TableEventPayload", p)
			}
		case <-deadline:
			done = true
		}
	}
	for _, k := range []string{table.KindPlayerSeated, table.KindHandStarted, table.KindBlindPosted, table.KindHoleCards,
		table.KindPlayerActed, table.KindTurnStarted, table.KindStreetDealt, table.KindCardsRevealed, table.KindPotAwarded,
		table.KindHandCompleted, table.KindSittingOut} {
		if !kinds[k] {
			t.Errorf("event kind %s was not exercised", k)
		}
	}
	for _, viewer := range []string{"", e.users["alice"], e.users["bob"]} {
		snap := e.snapshot(a, viewer)
		b, _ := json.Marshal(snap)
		validate(t, doc, "TableSnapshot", b)
	}
}
