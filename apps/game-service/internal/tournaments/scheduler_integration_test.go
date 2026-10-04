//go:build integration

package tournaments_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	mrand "math/rand/v2"
	"path/filepath"
	"runtime"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/bar1287/kofclub/apps/game-service/internal/lease"
	"github.com/bar1287/kofclub/apps/game-service/internal/registry"
	"github.com/bar1287/kofclub/apps/game-service/internal/sealer"
	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/apps/game-service/internal/table"
	"github.com/bar1287/kofclub/apps/game-service/internal/tournaments"
	ledger "github.com/bar1287/kofclub/go/ledger-client"
	"github.com/bar1287/kofclub/go/pgtest"
	"github.com/bar1287/kofclub/go/poker"
)

const (
	grant   = 5000
	buyIn   = 100
	stack   = 1000
	perSeat = 3
)

type env struct {
	t        *testing.T
	ctx      context.Context
	pool     *pgxpool.Pool
	seal     *sealer.Sealer
	clubID   string
	owner    string
	users    []string
	names    map[string]string
	treasury string
	logs     *syncBuffer
}

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// dump prints the tournament's durable state and warnings (diagnostics).
func (e *env) dump(tid string) {
	e.t.Helper()
	q := func(title, sql string) {
		rows, err := e.pool.Query(e.ctx, sql, tid)
		if err != nil {
			e.t.Logf("%s: %v", title, err)
			return
		}
		defer rows.Close()
		e.t.Logf("== %s", title)
		for rows.Next() {
			v, _ := rows.Values()
			e.t.Logf("   %v", v)
		}
	}
	q("runtime", `SELECT status, entrants, total_chips FROM tournament_runtime WHERE tournament_id = $1`)
	q("seats", `SELECT t.tournament_table_no, s.seat_no, s.user_id, s.stack_cached, s.sitting_out FROM table_seats s JOIN tables t ON t.id = s.table_id WHERE t.tournament_id = $1 ORDER BY 1, 2`)
	q("transfers", `SELECT user_id, from_table_id, to_table_id, seat_no, stack FROM tournament_transfers WHERE tournament_id = $1`)
	q("entries", `SELECT user_id, place, table_id FROM tournament_entries WHERE tournament_id = $1 ORDER BY place NULLS FIRST`)
	q("hands in progress", `SELECT t.tournament_table_no, h.hand_no FROM hands h JOIN tables t ON t.id = h.table_id WHERE t.tournament_id = $1 AND h.status = 'IN_PROGRESS'`)
	q("leases", `SELECT t.tournament_table_no, l.owner_node_id, l.expires_at > now() FROM table_leases l JOIN tables t ON t.id = l.table_id WHERE t.tournament_id = $1 ORDER BY 1`)
	out := e.logs.String()
	if len(out) > 20000 {
		out = out[len(out)-20000:]
	}
	e.t.Logf("== logs\n%s", out)
}

func newEnv(t *testing.T, players int) *env {
	t.Helper()
	pool, _ := pgtest.NewPool(t)
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	seal, err := sealer.New(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, ctx: context.Background(), pool: pool, seal: seal, names: map[string]string{}, logs: &syncBuffer{}}
	for i := 0; i < players; i++ {
		id := uuid.NewString()
		name := fmt.Sprintf("p%d_%s", i, id[:6])
		e.exec(`INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, 'x')`, id, name+"@example.test", name)
		e.users = append(e.users, id)
		e.names[id] = name
	}
	e.owner = e.users[0]
	e.clubID = uuid.NewString()
	e.exec(`INSERT INTO clubs (id, owner_user_id, name, join_code) VALUES ($1, $2, 'Club', $3)`, e.clubID, e.owner, e.clubID[:8])
	if e.treasury, err = ledger.EnsureAccount(e.ctx, pool, e.clubID, ledger.AccountClubTreasury, e.clubID, ""); err != nil {
		t.Fatal(err)
	}
	for _, u := range e.users {
		wallet := e.account(ledger.AccountMemberWallet, u)
		e.post(ledger.KindClubGrant, "grant:"+u, e.treasury, wallet, grant)
	}
	return e
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.pool.Exec(e.ctx, sql, args...); err != nil {
		e.t.Fatalf("%s: %v", sql, err)
	}
}

func (e *env) account(kind ledger.AccountKind, owner string) string {
	e.t.Helper()
	id, err := ledger.EnsureAccount(e.ctx, e.pool, e.clubID, kind, owner, "")
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) post(kind ledger.Kind, ref, from, to string, amount int64) {
	e.t.Helper()
	if _, err := ledger.Post(e.ctx, e.pool, ledger.Posting{Kind: kind, ActorType: "SYSTEM", ClubID: e.clubID, ExternalRef: ref,
		Entries: []ledger.Entry{{AccountID: from, Amount: -amount}, {AccountID: to, Amount: amount}}}); err != nil {
		e.t.Fatal(err)
	}
}

// tournament creates a tournament with its tables and registers players
// with ledger buy-ins, as the control-api directory does.
func (e *env) tournament(mode string, startsAt *time.Time, minPlayers, maxPlayers int, players []string) string {
	e.t.Helper()
	id := uuid.NewString()
	e.exec(`INSERT INTO tournaments (id, club_id, name, buy_in, starting_stack, small_blind, big_blind, level_duration_sec,
	        seats_per_table, min_players, max_players, start_mode, starts_at, action_timeout_ms, created_by)
	        VALUES ($1, $2, 'Test Cup', $3, $4, 10, 20, 10, $5, $6, $7, $8, $9, 10000, $10)`,
		id, e.clubID, buyIn, stack, perSeat, minPlayers, maxPlayers, mode, startsAt, e.owner)
	for no := 1; no <= (maxPlayers+perSeat-1)/perSeat; no++ {
		e.exec(`INSERT INTO tables (id, club_id, name, max_seats, small_blind, big_blind, buyin_min, buyin_max, created_by, tournament_id, tournament_table_no, action_timeout_ms)
		        VALUES ($1, $2, $3, $4, 10, 20, $5, $5, $6, $7, $8, 10000)`,
			uuid.NewString(), e.clubID, fmt.Sprintf("Test Cup #%d", no), perSeat, stack, e.owner, id, no)
	}
	pool := e.account(ledger.AccountTournamentPool, id)
	for _, u := range players {
		reg := uuid.NewString()
		e.post(ledger.KindTournamentBuyIn, "tournament-buyin:"+reg, e.account(ledger.AccountMemberWallet, u), pool, buyIn)
		e.exec(`INSERT INTO tournament_registrations (id, tournament_id, user_id, buy_in) VALUES ($1, $2, $3, $4)`, reg, id, u, buyIn)
	}
	return id
}

// node starts a game-service node (registry with orphan adoption plus the
// tournament starter); stop simulates the process dying.
func (e *env) node(name string) (reg *registry.Registry, starter *tournaments.Scheduler, stop func()) {
	e.t.Helper()
	timing := table.Timing{StartDelay: 10 * time.Millisecond, HandInterval: 20 * time.Millisecond, RetryBackoff: 50 * time.Millisecond,
		MaxTimeouts: 2, ActionTimeout: 10 * time.Second, TournamentPoll: 50 * time.Millisecond}
	deps := table.Deps{
		Store: store.New(e.pool, name), Sealer: e.seal, Log: slog.New(slog.NewTextHandler(e.logs, &slog.HandlerOptions{Level: slog.LevelInfo})).With(slog.String("node", name)),
		Metrics: table.NewMetrics(prometheus.NewRegistry()), Rand: rand.Reader, Timing: timing,
		Wake: func(id string) { reg.Wake(id) },
	}
	reg = registry.New(deps, lease.NewManager(e.pool, name, "http://"+name, 10*time.Second),
		registry.Options{OrphanScanInterval: 100 * time.Millisecond, IdleCheckInterval: time.Hour})
	ctx, cancel := context.WithCancel(e.ctx)
	done := make(chan struct{})
	stop = func() {
		cancel()
		<-done
		reg.StopAll()
	}
	e.t.Cleanup(func() {
		select {
		case <-ctx.Done():
		default:
			stop()
		}
	})
	go func() { reg.Run(ctx); close(done) }()
	starter = tournaments.New(deps.Store, rand.Reader, func(ctx context.Context, id string) error {
		_, err := reg.Get(ctx, id)
		return err
	}, deps.Log, time.Hour)
	return reg, starter, stop
}

func (e *env) status(id string) string {
	var s string
	_ = e.pool.QueryRow(e.ctx, `SELECT coalesce((SELECT status FROM tournament_runtime WHERE tournament_id = $1), '')`, id).Scan(&s)
	return s
}

func (e *env) balance(kind ledger.AccountKind, owner string) int64 {
	b, err := ledger.Balance(e.ctx, e.pool, e.account(kind, owner))
	if err != nil {
		e.t.Fatal(err)
	}
	return b
}

// play acts for whoever is to act at every local table, preferring all-ins
// so the tournament ends quickly. It returns the number of actions.
func play(e *env, reg *registry.Registry, r *mrand.Rand) int {
	acted := 0
	for _, id := range reg.Tables() {
		a, err := reg.Get(e.ctx, id)
		if err != nil {
			continue
		}
		pub, err := a.Snapshot(e.ctx, "")
		if err != nil || pub.Hand == nil || pub.Hand.ToActSeat == 0 {
			continue
		}
		var user string
		for _, s := range pub.Seats {
			if s.Seat == pub.Hand.ToActSeat {
				user = s.UserID
			}
		}
		mine, err := a.Snapshot(e.ctx, user)
		if err != nil || mine.You == nil {
			continue
		}
		kinds := map[poker.ActionKind]bool{}
		for _, la := range mine.You.LegalActions {
			kinds[la.Kind] = true
		}
		kind := "FOLD"
		switch roll := r.IntN(10); {
		case roll < 5 && kinds[poker.ActionAllIn]:
			kind = "ALL_IN"
		case kinds[poker.ActionCheck]:
			kind = "CHECK"
		case roll < 8 && kinds[poker.ActionCall]:
			kind = "CALL"
		}
		seq := mine.Seq
		if _, err := a.Command(e.ctx, table.CommandRequest{UserID: user, CommandID: uuid.NewString(), ExpectedSeq: &seq, Kind: kind, ReceivedAt: time.Now()}); err == nil {
			acted++
		}
	}
	return acted
}

// A seven-player sit-and-go on three-handed tables: it starts when full,
// seats everyone at the fewest tables, moves players to balance and break
// tables, survives a node crash, eliminates players with places and pays
// the prize pool out exactly once.
func TestSitAndGoRunsToTheEnd(t *testing.T) {
	const players = 7
	e := newEnv(t, players)
	tid := e.tournament("SIT_AND_GO", nil, 2, players, e.users[:players-1])
	nodeA, starter, stopA := e.node("node-a")

	if out, err := starter.Start(e.ctx, tid); err != nil || out != tournaments.NotDue {
		t.Fatalf("a sit-and-go waits until full: %v %v", out, err)
	}
	// The last registration fills it.
	last := e.users[players-1]
	reg := uuid.NewString()
	e.post(ledger.KindTournamentBuyIn, "tournament-buyin:"+reg, e.account(ledger.AccountMemberWallet, last), e.account(ledger.AccountTournamentPool, tid), buyIn)
	e.exec(`INSERT INTO tournament_registrations (id, tournament_id, user_id, buy_in) VALUES ($1, $2, $3, $4)`, reg, tid, last, buyIn)
	if out, err := starter.Start(e.ctx, tid); err != nil || out != tournaments.Started {
		t.Fatalf("start: %v %v", out, err)
	}
	if out, _ := starter.Start(e.ctx, tid); out != tournaments.NotDue {
		t.Fatal("a tournament starts once")
	}

	var seatCounts []int
	rows, _ := e.pool.Query(e.ctx, `SELECT count(s.user_id) FROM tables t LEFT JOIN table_seats s ON s.table_id = t.id
	                                 WHERE t.tournament_id = $1 GROUP BY t.tournament_table_no ORDER BY t.tournament_table_no`, tid)
	for rows.Next() {
		var n int
		_ = rows.Scan(&n)
		seatCounts = append(seatCounts, n)
	}
	rows.Close()
	sort.Ints(seatCounts)
	if fmt.Sprint(seatCounts) != "[2 2 3]" {
		t.Fatalf("initial seating %v", seatCounts)
	}
	if len(nodeA.Tables()) != 3 {
		t.Fatalf("tables activated: %v", nodeA.Tables())
	}
	snap, err := func() (table.Snapshot, error) {
		a, _ := nodeA.Get(e.ctx, nodeA.Tables()[0])
		return a.Snapshot(e.ctx, "")
	}()
	if err != nil || snap.Table.Tournament == nil || snap.Table.Tournament.Level != 1 || snap.Table.BigBlind != 20 {
		t.Fatalf("tournament snapshot: %+v %v", snap.Table.Tournament, err)
	}
	snapJSON, _ := json.Marshal(snap)
	var snapAny any
	_ = json.Unmarshal(snapJSON, &snapAny)
	if err := loadRealtimeSpec(t).Components.Schemas["TableSnapshot"].Value.VisitJSON(snapAny); err != nil {
		t.Fatalf("tournament snapshot does not match realtime.yaml: %v", err)
	}

	r := mrand.New(mrand.NewPCG(1, 2))
	deadline := time.Now().Add(30 * time.Second)
	crashed := false
	node := nodeA
	for e.status(tid) == "RUNNING" {
		if time.Now().After(deadline) {
			e.dump(tid)
			t.Fatal("tournament did not finish")
		}
		if play(e, node, r) == 0 {
			time.Sleep(20 * time.Millisecond)
		}
		var eliminated int
		_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM tournament_entries WHERE tournament_id = $1 AND place IS NOT NULL`, tid).Scan(&eliminated)
		if !crashed && eliminated >= 2 {
			// Crash: every actor stops; a second node adopts the tables
			// (seats, transfers, unfinished hands) and the tournament goes on.
			crashed = true
			stopA()
			e.exec(`UPDATE table_leases SET expires_at = now() - interval '1 second'`)
			node, _, _ = e.node("node-b")
		}
	}
	if e.status(tid) != "FINISHED" {
		t.Fatalf("status %s", e.status(tid))
	}

	// Places: one winner, competition ranking over all entrants.
	rows, _ = e.pool.Query(e.ctx, `SELECT user_id::text, place, prize FROM tournament_entries WHERE tournament_id = $1 ORDER BY place`, tid)
	var places []int
	var prizes int64
	for rows.Next() {
		var u string
		var place int
		var prize int64
		if err := rows.Scan(&u, &place, &prize); err != nil {
			t.Fatal(err)
		}
		places = append(places, place)
		prizes += prize
	}
	rows.Close()
	if len(places) != players || places[0] != 1 || places[1] == 1 {
		t.Fatalf("places %v", places)
	}
	for i, p := range places {
		if p > i+1 {
			t.Fatalf("places are not a competition ranking: %v", places)
		}
	}
	if prizes != players*buyIn {
		t.Fatalf("prizes %d != pool %d", prizes, players*buyIn)
	}
	if b := e.balance(ledger.AccountTournamentPool, tid); b != 0 {
		t.Fatalf("pool still holds %d", b)
	}
	var wallets int64
	for _, u := range e.users {
		wallets += e.balance(ledger.AccountMemberWallet, u)
	}
	if wallets != players*grant {
		t.Fatalf("wallets hold %d, granted %d", wallets, players*grant)
	}
	var payouts, seats, transfers, moved int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM ledger_transactions WHERE kind = 'TOURNAMENT_PAYOUT' AND reference_id = $1`, tid).Scan(&payouts)
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM table_seats s JOIN tables t ON t.id = s.table_id WHERE t.tournament_id = $1`, tid).Scan(&seats)
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM tournament_transfers WHERE tournament_id = $1`, tid).Scan(&transfers)
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM game_events g JOIN tables t ON t.id = g.table_id
	                            WHERE t.tournament_id = $1 AND g.event_type = 'PLAYER_LEFT' AND g.payload_json->>'reason' = 'MOVED'`, tid).Scan(&moved)
	if payouts != 1 || seats != 0 || transfers != 0 {
		t.Fatalf("payouts %d, seats left %d, transfers left %d", payouts, seats, transfers)
	}
	if moved == 0 {
		t.Fatal("expected players to be moved between tables")
	}
	v, err := ledger.Violations(e.ctx, e.pool)
	if err != nil || len(v) != 0 {
		t.Fatalf("ledger violations %+v %v", v, err)
	}
	// Every persisted public event of the tournament's tables (seating,
	// moves, eliminations, the finish, HAND_STARTED with the level) matches
	// the realtime contract.
	doc := loadRealtimeSpec(t)
	rows, _ = e.pool.Query(e.ctx, `SELECT g.payload_json FROM game_events g JOIN tables t ON t.id = g.table_id WHERE t.tournament_id = $1`, tid)
	kinds := map[string]bool{}
	for rows.Next() {
		var payload []byte
		_ = rows.Scan(&payload)
		var ev map[string]any
		if err := json.Unmarshal(payload, &ev); err != nil {
			t.Fatal(err)
		}
		if err := doc.Components.Schemas["TableEventPayload"].Value.VisitJSON(ev); err != nil {
			t.Fatalf("event does not match realtime.yaml: %v\n%s", err, payload)
		}
		if ev["kind"] == "PLAYER_LEFT" {
			kinds[ev["reason"].(string)] = true
		}
	}
	rows.Close()
	for _, reason := range []string{"MOVED", "ELIMINATED", "FINISHED"} {
		if !kinds[reason] {
			t.Errorf("no PLAYER_LEFT %s event", reason)
		}
	}
	// Tournament hands never settle in the ledger (tournament chips only).
	var settlements int
	_ = e.pool.QueryRow(e.ctx, `SELECT count(*) FROM ledger_transactions WHERE kind = 'HAND_SETTLEMENT' AND club_id = $1`, e.clubID).Scan(&settlements)
	if settlements != 0 {
		t.Fatalf("%d hand settlements for tournament hands", settlements)
	}
	t.Logf("finished: places %v, moved %d, crash survived %v", places, moved, crashed)
}

func loadRealtimeSpec(t *testing.T) *openapi3.T {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	doc, err := openapi3.NewLoader().LoadFromFile(filepath.Join(filepath.Dir(file), "../../../../packages/contracts/openapi/realtime.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

// A scheduled tournament short of players at its start time is cancelled
// and every buy-in refunded; its tables never open.
func TestScheduledTournamentShortOfPlayersIsCancelled(t *testing.T) {
	e := newEnv(t, 3)
	past := time.Now().Add(-time.Second)
	tid := e.tournament("SCHEDULED", &past, 3, 6, e.users[:2])
	nodeA, starter, _ := e.node("node-a")
	if out, err := starter.Start(e.ctx, tid); err != nil || out != tournaments.Cancelled {
		t.Fatalf("expected cancellation: %v %v", out, err)
	}
	if e.status(tid) != "CANCELLED" || e.balance(ledger.AccountTournamentPool, tid) != 0 {
		t.Fatalf("status %s pool %d", e.status(tid), e.balance(ledger.AccountTournamentPool, tid))
	}
	for _, u := range e.users[:2] {
		if b := e.balance(ledger.AccountMemberWallet, u); b != grant {
			t.Fatalf("refund missing: %d", b)
		}
	}
	var tableID string
	_ = e.pool.QueryRow(e.ctx, `SELECT id::text FROM tables WHERE tournament_id = $1 LIMIT 1`, tid).Scan(&tableID)
	if _, err := nodeA.Get(e.ctx, tableID); !errors.Is(err, table.ErrTournamentNotStarted) {
		t.Fatalf("tables of a cancelled tournament stay closed: %v", err)
	}

	// Scheduled with enough players: Tick starts it once its time has come.
	e2 := e.tournament("SCHEDULED", &past, 2, 6, e.users)
	starter.Tick(e.ctx)
	if e.status(e2) != "RUNNING" {
		t.Fatalf("scheduled start: %s", e.status(e2))
	}
	// Seats are assigned by the tournament: no buy-in or cash-out.
	var t2 string
	_ = e.pool.QueryRow(e.ctx, `SELECT t.id::text FROM tables t JOIN table_seats s ON s.table_id = t.id WHERE t.tournament_id = $1 LIMIT 1`, e2).Scan(&t2)
	a, err := nodeA.Get(e.ctx, t2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Sit(e.ctx, table.SitRequest{UserID: e.users[0], BuyIn: 500, RequestID: uuid.NewString()}); err == nil {
		t.Fatal("buy-in accepted at a tournament table")
	}
	if _, err := a.Leave(e.ctx, e.users[0], uuid.NewString()); err == nil {
		t.Fatal("cash-out accepted at a tournament table")
	}
}
