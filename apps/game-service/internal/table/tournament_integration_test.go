//go:build integration

package table_test

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/bar1287/kofclub/apps/game-service/internal/lease"
	"github.com/bar1287/kofclub/apps/game-service/internal/table"
)

// A tournament table that breaks while a player is on the way to it
// redirects that transfer and tells the player, who may already be watching
// it for their seat, where to go instead: PLAYER_LEFT MOVED with seat 0.
func TestBreakingTableRedirectsPlayersInTransit(t *testing.T) {
	e := newEnv(t, "alice", "bob", "carol", "dave")
	owner := e.users["alice"]
	tid := uuid.NewString()
	e.exec(`INSERT INTO tournaments (id, club_id, name, buy_in, starting_stack, small_blind, big_blind, level_duration_sec,
	        seats_per_table, min_players, max_players, start_mode, created_by)
	        VALUES ($1, $2, 'Redirect Cup', 0, 1000, 10, 20, 600, 6, 2, 12, 'SIT_AND_GO', $3)`, tid, e.clubID, owner)
	tables := make([]string, 2)
	for i := range tables {
		tables[i] = uuid.NewString()
		e.exec(`INSERT INTO tables (id, club_id, name, max_seats, small_blind, big_blind, buyin_min, buyin_max, created_by, tournament_id, tournament_table_no)
		        VALUES ($1, $2, $3, 6, 10, 20, 1000, 1000, $4, $5, $6)`, tables[i], e.clubID, fmt.Sprintf("Redirect Cup #%d", i+1), owner, tid, i+1)
	}
	e.exec(`INSERT INTO tournament_runtime (tournament_id, status, entrants, prize_pool, total_chips) VALUES ($1, 'RUNNING', 4, 0, 4000)`, tid)
	entry := func(name, tableID string) {
		reg := uuid.NewString()
		e.exec(`INSERT INTO tournament_registrations (id, tournament_id, user_id, buy_in) VALUES ($1, $2, $3, 0)`, reg, tid, e.users[name])
		e.exec(`INSERT INTO tournament_entries (tournament_id, user_id, registration_id, table_id) VALUES ($1, $2, $3, $4)`, tid, e.users[name], reg, tableID)
	}
	seat := func(name, tableID string, no int) {
		entry(name, tableID)
		e.exec(`INSERT INTO table_seats (table_id, seat_no, user_id, stack_cached) VALUES ($1, $2, $3, 1000)`, tableID, no, e.users[name])
	}
	// Table 1 seats alice and bob; table 2 seats carol, and dave is on his
	// way there from table 1 (not claimed yet). Four players fit one table:
	// table 2 (tied for fewest, highest number) breaks.
	seat("alice", tables[0], 1)
	seat("bob", tables[0], 2)
	seat("carol", tables[1], 1)
	entry("dave", tables[1])
	e.exec(`INSERT INTO tournament_transfers (tournament_id, user_id, from_table_id, to_table_id, seat_no, stack) VALUES ($1, $2, $3, $4, 2, 1000)`,
		tid, e.users["dave"], tables[0], tables[1])

	idle := table.Timing{StartDelay: time.Hour, HandInterval: time.Hour, RetryBackoff: 50 * time.Millisecond, ActionTimeout: 10 * time.Second, TournamentPoll: time.Hour}
	start := func(tableID string, timing table.Timing) *table.Actor {
		l, err := lease.NewManager(e.pool, "node-a", "http://node-a", 10*time.Second).Acquire(e.ctx, tableID)
		if err != nil {
			t.Fatal(err)
		}
		a, err := table.Start(e.ctx, e.deps("node-a", rand.Reader, timing), tableID, l.Epoch)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { a.Stop(nil); <-a.Done() })
		return a
	}
	breaking := start(tables[1], idle)
	if moved, err := breaking.RebalanceNow(e.ctx); err != nil || !moved {
		t.Fatalf("the table did not break: %v %v", moved, err)
	}

	// Both players go to table 1: carol from her seat, dave redirected.
	rows, err := e.pool.Query(e.ctx, `SELECT u.username, x.to_table_id::text, x.seat_no, e.table_id::text
	                                   FROM tournament_transfers x JOIN users u ON u.id = x.user_id
	                                   JOIN tournament_entries e ON e.tournament_id = x.tournament_id AND e.user_id = x.user_id
	                                  WHERE x.tournament_id = $1 ORDER BY u.username`, tid)
	if err != nil {
		t.Fatal(err)
	}
	var transfers []string
	seatsUsed := map[int]bool{1: true, 2: true}
	for rows.Next() {
		var name, to, entryTable string
		var no int
		if err := rows.Scan(&name, &to, &no, &entryTable); err != nil {
			t.Fatal(err)
		}
		if to != tables[0] || entryTable != tables[0] || seatsUsed[no] {
			t.Fatalf("%s: transfer to %s seat %d, entry at %s", name, to, no, entryTable)
		}
		seatsUsed[no] = true
		transfers = append(transfers, name)
	}
	rows.Close()
	if fmt.Sprint(transfers) != "[carol dave]" {
		t.Fatalf("transfers %v", transfers)
	}

	// The breaking table's stream says where each of them goes; dave never
	// sat there (seat 0). Both events match the realtime contract.
	doc := loadRealtimeSpec(t)
	rows, err = e.pool.Query(e.ctx, `SELECT payload_json FROM game_events WHERE table_id = $1 AND event_type = 'PLAYER_LEFT' ORDER BY seq`, tables[1])
	if err != nil {
		t.Fatal(err)
	}
	type leftEvent struct {
		Seat      int    `json:"seat"`
		UserID    string `json:"userId"`
		Reason    string `json:"reason"`
		ToTableID string `json:"toTableId"`
	}
	var left []leftEvent
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			t.Fatal(err)
		}
		validate(t, doc, "TableEventPayload", payload)
		var ev leftEvent
		if err := json.Unmarshal(payload, &ev); err != nil {
			t.Fatal(err)
		}
		left = append(left, ev)
	}
	rows.Close()
	want := []leftEvent{
		{Seat: 1, UserID: e.users["carol"], Reason: "MOVED", ToTableID: tables[0]},
		{Seat: 0, UserID: e.users["dave"], Reason: "MOVED", ToTableID: tables[0]},
	}
	if fmt.Sprint(left) != fmt.Sprint(want) {
		t.Fatalf("PLAYER_LEFT events %+v, want %+v", left, want)
	}

	// Table 1 claims both: four players, chips conserved, nothing in transit.
	start(tables[0], table.Timing{StartDelay: time.Hour, HandInterval: time.Hour, RetryBackoff: 50 * time.Millisecond,
		ActionTimeout: 10 * time.Second, TournamentPoll: 20 * time.Millisecond})
	waitFor(t, "table 1 claims the transfers", 5*time.Second, func() bool {
		var seated, transit int
		_ = e.pool.QueryRow(e.ctx, `SELECT (SELECT count(*) FROM table_seats WHERE table_id = $1),
		                                   (SELECT count(*) FROM tournament_transfers WHERE tournament_id = $2)`, tables[0], tid).Scan(&seated, &transit)
		return seated == 4 && transit == 0
	})
	var chips int64
	_ = e.pool.QueryRow(e.ctx, `SELECT sum(stack_cached) FROM table_seats WHERE table_id = $1`, tables[0]).Scan(&chips)
	if chips != 4000 {
		t.Fatalf("chips at table 1: %d", chips)
	}
}
