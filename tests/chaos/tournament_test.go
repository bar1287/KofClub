//go:build integration

package chaos

import (
	"bufio"
	"fmt"
	mrand "math/rand/v2"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	ledger "github.com/bar1287/kofclub/go/ledger-client"
)

const (
	tourPlayers = 7
	tourBuyIn   = 100
	tourStack   = 1000
)

// tournament creates a full sit-and-go (7 players, 3-handed tables) with
// paid registrations, as the control-api directory does; the game nodes'
// starters pick it up.
func (d *drill) tournament() (string, []string) {
	d.t.Helper()
	var players []string
	treasury, _ := ledger.EnsureAccount(d.ctx, d.pool, d.clubID, ledger.AccountClubTreasury, d.clubID, "")
	for i := 0; i < tourPlayers; i++ {
		id := uuid.NewString()
		name := fmt.Sprintf("t%d_%s", i, id[:6])
		d.exec(`INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, 'x')`, id, name+"@example.test", name)
		d.exec(`INSERT INTO club_members (club_id, user_id, role) VALUES ($1, $2, 'MEMBER')`, d.clubID, id)
		wallet, _ := ledger.EnsureAccount(d.ctx, d.pool, d.clubID, ledger.AccountMemberWallet, id, "")
		if _, err := ledger.Post(d.ctx, d.pool, ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM", ClubID: d.clubID,
			ExternalRef: "grant:" + id, Entries: []ledger.Entry{{AccountID: treasury, Amount: -5000}, {AccountID: wallet, Amount: 5000}}}); err != nil {
			d.t.Fatal(err)
		}
		d.granted += 5000
		players = append(players, id)
	}
	tid := uuid.NewString()
	d.exec(`INSERT INTO tournaments (id, club_id, name, buy_in, starting_stack, small_blind, big_blind, level_duration_sec,
	        seats_per_table, min_players, max_players, start_mode, action_timeout_ms, created_by)
	        VALUES ($1, $2, 'Chaos Cup', $3, $4, 10, 20, 60, 3, 2, $5, 'SIT_AND_GO', 10000, $6)`,
		tid, d.clubID, tourBuyIn, tourStack, tourPlayers, d.users["alice"])
	for no := 1; no <= 3; no++ {
		d.exec(`INSERT INTO tables (id, club_id, name, max_seats, small_blind, big_blind, buyin_min, buyin_max, action_timeout_ms, created_by, tournament_id, tournament_table_no)
		        VALUES ($1, $2, $3, 3, 10, 20, $4, $4, 10000, $5, $6, $7)`,
			uuid.NewString(), d.clubID, fmt.Sprintf("Chaos Cup #%d", no), tourStack, d.users["alice"], tid, no)
	}
	pool, _ := ledger.EnsureAccount(d.ctx, d.pool, d.clubID, ledger.AccountTournamentPool, tid, "")
	for _, u := range players {
		reg := uuid.NewString()
		wallet, _ := ledger.EnsureAccount(d.ctx, d.pool, d.clubID, ledger.AccountMemberWallet, u, "")
		if _, err := ledger.Post(d.ctx, d.pool, ledger.Posting{Kind: ledger.KindTournamentBuyIn, ActorType: "USER", ActorUserID: u, ClubID: d.clubID,
			ExternalRef: "tournament-buyin:" + reg, Entries: []ledger.Entry{{AccountID: wallet, Amount: -tourBuyIn}, {AccountID: pool, Amount: tourBuyIn}}}); err != nil {
			d.t.Fatal(err)
		}
		d.exec(`INSERT INTO tournament_registrations (id, tournament_id, user_id, buy_in) VALUES ($1, $2, $3, $4)`, reg, tid, u, tourBuyIn)
	}
	return tid, players
}

// tableOwners maps each tournament table with a live lease to its node.
func (d *drill) tableOwners(tid string, nodes map[string]*node) map[string]*node {
	rows, err := d.pool.Query(d.ctx, `
		SELECT t.id::text, l.owner_node_id FROM tables t JOIN table_leases l ON l.table_id = t.id
		 WHERE t.tournament_id = $1 AND l.expires_at > now()`, tid)
	if err != nil {
		d.t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]*node{}
	for rows.Next() {
		var table, owner string
		_ = rows.Scan(&table, &owner)
		if n, ok := nodes[owner]; ok {
			out[table] = n
		}
	}
	return out
}

// playTournamentStep acts once at every table where someone is to act,
// preferring all-ins so the tournament moves quickly.
func (d *drill) playTournamentStep(owners map[string]*node, r *mrand.Rand) int {
	acted := 0
	for table, n := range owners {
		var pub snapshot
		if d.call(n, http.MethodGet, "/internal/v1/tables/"+table+"/snapshot", nil, &pub) != http.StatusOK ||
			pub.Hand == nil || pub.Hand.ToActSeat == 0 {
			continue
		}
		var actor string
		for _, s := range pub.Seats {
			if s.Seat == pub.Hand.ToActSeat {
				actor = s.UserID
			}
		}
		var mine snapshot
		if d.call(n, http.MethodGet, "/internal/v1/tables/"+table+"/snapshot?viewer="+actor, nil, &mine) != http.StatusOK || mine.You == nil {
			continue
		}
		kinds := map[string]bool{}
		for _, la := range mine.You.LegalActions {
			kinds[la.Kind] = true
		}
		kind := "FOLD"
		switch roll := r.IntN(10); {
		case roll < 6 && kinds["ALL_IN"]:
			kind = "ALL_IN"
		case kinds["CHECK"]:
			kind = "CHECK"
		case kinds["CALL"]:
			kind = "CALL"
		}
		if d.call(n, http.MethodPost, "/internal/v1/tables/"+table+"/commands",
			map[string]any{"userId": actor, "commandId": uuid.NewString(), "kind": kind}, nil) == http.StatusOK {
			acted++
		}
	}
	return acted
}

// scrape returns a counter's value from a node's /metrics (0 when absent).
func scrape(t *testing.T, n *node, metric string) float64 {
	t.Helper()
	res, err := http.Get(n.url + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, metric+" ") {
			var v float64
			_, _ = fmt.Sscanf(strings.TrimPrefix(line, metric+" "), "%g", &v)
			return v
		}
	}
	return 0
}

// Spec §21 for tournaments: the node running a multi-table tournament is
// killed (SIGKILL) after the first eliminations. The other node adopts every
// table, seat and pending move, the tournament plays to the end, and the
// prize pool is paid out exactly once with every chip accounted for.
func TestKillNodeRunningATournament(t *testing.T) {
	d := newDrill(t)
	fast := []string{"HAND_INTERVAL=50ms", "TOURNAMENT_SCAN_INTERVAL=200ms", "TOURNAMENT_POLL_INTERVAL=200ms"}
	tid, players := d.tournament()
	nodes := map[string]*node{"node-a": d.start("node-a", fast...), "node-b": d.start("node-b", fast...)}

	status := func() string {
		var s string
		_ = d.pool.QueryRow(d.ctx, `SELECT coalesce((SELECT status FROM tournament_runtime WHERE tournament_id = $1), '')`, tid).Scan(&s)
		return s
	}
	d.waitFor("tournament start", 15*time.Second, func() bool { return status() == "RUNNING" })

	r := mrand.New(mrand.NewPCG(11, 12))
	var killed *node
	var killedAt time.Time
	deadline := time.Now().Add(120 * time.Second)
	for status() == "RUNNING" {
		if time.Now().After(deadline) {
			t.Fatal("tournament did not finish")
		}
		owners := d.tableOwners(tid, nodes)
		if d.playTournamentStep(owners, r) == 0 {
			time.Sleep(50 * time.Millisecond)
		}
		var eliminated int
		_ = d.pool.QueryRow(d.ctx, `SELECT count(*) FROM tournament_entries WHERE tournament_id = $1 AND place IS NOT NULL`, tid).Scan(&eliminated)
		if killed == nil && eliminated >= 2 {
			// Kill the node owning the most tables, mid-tournament.
			counts := map[*node]int{}
			for _, n := range owners {
				counts[n]++
			}
			for n, c := range counts {
				if killed == nil || c > counts[killed] {
					killed = n
				}
			}
			if killed == nil {
				continue
			}
			t.Logf("killing %s (owns %d tournament tables, %d players out)", killed.id, counts[killed], eliminated)
			if err := killed.cmd.Process.Kill(); err != nil {
				t.Fatal(err)
			}
			<-killed.exited
			delete(nodes, killed.id)
			killedAt = time.Now()
		}
	}
	if status() != "FINISHED" {
		t.Fatalf("status %s", status())
	}
	if killed == nil {
		t.Fatal("the tournament ended before the crash could be injected")
	}
	var survivor *node
	for _, n := range nodes {
		survivor = n
	}
	t.Logf("finished %.1fs after the crash", time.Since(killedAt).Seconds())

	// Results: one winner, places for everyone, prizes = pool, paid once.
	var winners, unplaced int
	var prizes int64
	_ = d.pool.QueryRow(d.ctx, `SELECT count(*) FILTER (WHERE place = 1), count(*) FILTER (WHERE place IS NULL), coalesce(sum(prize), 0)
	                            FROM tournament_entries WHERE tournament_id = $1`, tid).Scan(&winners, &unplaced, &prizes)
	if winners != 1 || unplaced != 0 || prizes != tourPlayers*tourBuyIn {
		t.Fatalf("results: winners %d unplaced %d prizes %d", winners, unplaced, prizes)
	}
	var payouts int
	_ = d.pool.QueryRow(d.ctx, `SELECT count(*) FROM ledger_transactions WHERE kind = 'TOURNAMENT_PAYOUT' AND reference_id = $1`, tid).Scan(&payouts)
	if payouts != 1 {
		t.Fatalf("payouts posted: %d", payouts)
	}

	// Chips: ledger and tournament invariants hold, nothing created or lost.
	violations, err := ledger.Violations(d.ctx, d.pool)
	if err != nil || len(violations) != 0 {
		t.Fatalf("ledger violations: %+v %v", violations, err)
	}
	var tourViolations int
	_ = d.pool.QueryRow(d.ctx, `SELECT count(*) FROM tournament_invariant_violations`).Scan(&tourViolations)
	if tourViolations != 0 {
		t.Fatalf("%d tournament invariant violations", tourViolations)
	}
	var wallets int64
	_ = d.pool.QueryRow(d.ctx, `SELECT coalesce(sum(balance), 0)::bigint FROM ledger_accounts WHERE club_id = $1 AND kind <> 'CLUB_TREASURY'`, d.clubID).Scan(&wallets)
	if wallets != d.granted {
		t.Fatalf("chips not conserved: %d in accounts, %d granted", wallets, d.granted)
	}
	var running, transfers, seats int
	_ = d.pool.QueryRow(d.ctx, `SELECT running, transfers_pending FROM tournament_health`).Scan(&running, &transfers)
	_ = d.pool.QueryRow(d.ctx, `SELECT count(*) FROM table_seats s JOIN tables t ON t.id = s.table_id WHERE t.tournament_id = $1`, tid).Scan(&seats)
	if running != 0 || transfers != 0 || seats != 0 {
		t.Fatalf("leftovers: running %d transfers %d seats %d", running, transfers, seats)
	}
	// The survivor finished it and the event logs stayed gap-free.
	if got := scrape(t, survivor, "game_tournaments_finished_total"); got != 1 {
		t.Fatalf("survivor finished %v tournaments", got)
	}
	rows, _ := d.pool.Query(d.ctx, `SELECT g.table_id::text, count(*), max(g.seq) FROM game_events g JOIN tables t ON t.id = g.table_id
	                                 WHERE t.tournament_id = $1 GROUP BY g.table_id`, tid)
	for rows.Next() {
		var table string
		var count, maxSeq int64
		_ = rows.Scan(&table, &count, &maxSeq)
		if count != maxSeq {
			t.Fatalf("table %s event log has gaps: %d events, max seq %d", table, count, maxSeq)
		}
	}
	rows.Close()
	_ = players
}
