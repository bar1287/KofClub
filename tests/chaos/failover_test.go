//go:build integration

// Package chaos runs failure drills against real game-service processes
// (spec §21 "kill game-service mid-hand"): processes are killed with SIGKILL,
// so nothing is released or flushed on the way out.
package chaos

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	ledger "github.com/bar1287/kofclub/go/ledger-client"
	"github.com/bar1287/kofclub/go/pgtest"
)

type legalAction struct {
	Kind string `json:"kind"`
}

type snapshot struct {
	Seq  int64 `json:"seq"`
	Hand *struct {
		HandID    string   `json:"handId"`
		HandNo    int64    `json:"handNo"`
		Street    string   `json:"street"`
		Board     []string `json:"board"`
		Pot       int64    `json:"pot"`
		ToActSeat int      `json:"toActSeat"`
	} `json:"hand"`
	Seats []struct {
		Seat   int    `json:"seat"`
		UserID string `json:"userId"`
		Stack  int64  `json:"stack"`
	} `json:"seats"`
	You *struct {
		Seat         int           `json:"seat"`
		HoleCards    []string      `json:"holeCards"`
		LegalActions []legalAction `json:"legalActions"`
	} `json:"you"`
}

// node is one game-service process.
type node struct {
	id     string
	url    string
	cmd    *exec.Cmd
	logs   *syncBuffer
	exited chan struct{}
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

type drill struct {
	t       *testing.T
	ctx     context.Context
	pool    *pgxpool.Pool
	dbURL   string
	bin     string
	key     string
	token   string
	clubID  string
	tableID string
	users   map[string]string
	granted int64
}

func repoRoot() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "../..")
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func newDrill(t *testing.T) *drill {
	t.Helper()
	dbURL := pgtest.NewDatabase(t, true)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	bin := filepath.Join(t.TempDir(), "game-service")
	build := exec.Command("go", "build", "-o", bin, "./apps/game-service/cmd/game-service")
	build.Dir = repoRoot()
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build game-service: %v\n%s", err, out)
	}
	key := make([]byte, 32)
	_, _ = rand.Read(key)

	d := &drill{t: t, ctx: ctx, pool: pool, dbURL: dbURL, bin: bin, key: base64.StdEncoding.EncodeToString(key),
		token: randomHex(24), users: map[string]string{}}
	d.fixture("alice", "bob")
	return d
}

func (d *drill) exec(sql string, args ...any) {
	d.t.Helper()
	if _, err := d.pool.Exec(d.ctx, sql, args...); err != nil {
		d.t.Fatalf("%s: %v", sql, err)
	}
}

func (d *drill) fixture(names ...string) {
	for _, n := range names {
		id := uuid.NewString()
		d.exec(`INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, 'x')`, id, n+"@example.test", n)
		d.users[n] = id
	}
	d.clubID = uuid.NewString()
	d.exec(`INSERT INTO clubs (id, owner_user_id, name, join_code) VALUES ($1, $2, 'Chaos Club', $3)`, d.clubID, d.users[names[0]], strings.ToUpper(randomHex(4)))
	for _, n := range names {
		d.exec(`INSERT INTO club_members (club_id, user_id, role) VALUES ($1, $2, $3)`, d.clubID, d.users[n], map[bool]string{true: "OWNER", false: "MEMBER"}[n == names[0]])
	}
	d.tableID = uuid.NewString()
	d.exec(`INSERT INTO tables (id, club_id, name, max_seats, small_blind, big_blind, buyin_min, buyin_max, action_timeout_ms, created_by)
	        VALUES ($1, $2, 'Chaos Table', 6, 5, 10, 100, 2000, 60000, $3)`, d.tableID, d.clubID, d.users[names[0]])
	treasury, err := ledger.EnsureAccount(d.ctx, d.pool, d.clubID, ledger.AccountClubTreasury, d.clubID, "")
	if err != nil {
		d.t.Fatal(err)
	}
	for _, n := range names {
		wallet, err := ledger.EnsureAccount(d.ctx, d.pool, d.clubID, ledger.AccountMemberWallet, d.users[n], "")
		if err != nil {
			d.t.Fatal(err)
		}
		if _, err := ledger.Post(d.ctx, d.pool, ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM", ClubID: d.clubID,
			ExternalRef: "grant:" + n, Entries: []ledger.Entry{{AccountID: treasury, Amount: -5000}, {AccountID: wallet, Amount: 5000}}}); err != nil {
			d.t.Fatal(err)
		}
		d.granted += 5000
	}
}

// start launches a game-service process; env entries override the
// defaults (later entries win).
func (d *drill) start(id string, env ...string) *node {
	d.t.Helper()
	port := freePort(d.t)
	n := &node{id: id, url: fmt.Sprintf("http://127.0.0.1:%d", port), logs: &syncBuffer{}}
	n.cmd = exec.Command(d.bin)
	n.cmd.Env = append(os.Environ(),
		"APP_ENV=test", "LOG_LEVEL=info", "DATABASE_URL="+d.dbURL,
		fmt.Sprintf("GAME_SERVICE_PORT=%d", port), "GAME_NODE_ID="+id, "GAME_NODE_ADVERTISE_URL="+n.url,
		"INTERNAL_SERVICE_TOKEN="+d.token, "DECK_ENCRYPTION_KEY_B64="+d.key,
		"LEASE_TTL=3s", "ORPHAN_SCAN_INTERVAL=200ms", "HAND_START_DELAY=100ms", "HAND_INTERVAL=30s",
		"DRAIN_DELAY=10ms", "DRAIN_TIMEOUT=5s")
	n.cmd.Env = append(n.cmd.Env, env...)
	n.cmd.Stdout, n.cmd.Stderr = n.logs, n.logs
	if err := n.cmd.Start(); err != nil {
		d.t.Fatal(err)
	}
	exited := make(chan struct{})
	go func() {
		_ = n.cmd.Wait()
		close(exited)
	}()
	n.exited = exited
	d.t.Cleanup(func() {
		_ = n.cmd.Process.Kill()
		<-n.exited
		if d.t.Failed() {
			d.t.Logf("--- %s logs ---\n%s", n.id, n.logs.String())
		}
	})
	d.waitFor(id+" ready", 20*time.Second, func() bool {
		select {
		case <-n.exited:
			d.t.Fatalf("%s exited during startup:\n%s", id, n.logs.String())
		default:
		}
		res, err := http.Get(n.url + "/health/ready")
		if err != nil {
			return false
		}
		res.Body.Close()
		return res.StatusCode == http.StatusOK
	})
	return n
}

func (d *drill) waitFor(what string, timeout time.Duration, cond func() bool) {
	d.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	d.t.Fatalf("timed out waiting for %s", what)
}

// call performs an internal API request and returns the status code.
func (d *drill) call(n *node, method, path string, body, out any) int {
	d.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, n.url+path, rd)
	req.Header.Set("Authorization", "Bearer "+d.token)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0 // process gone
	}
	defer res.Body.Close()
	if out != nil && res.StatusCode == http.StatusOK {
		if err := json.NewDecoder(res.Body).Decode(out); err != nil {
			d.t.Fatal(err)
		}
	}
	return res.StatusCode
}

func (d *drill) snapshot(n *node, viewer string) (snapshot, int) {
	var s snapshot
	code := d.call(n, http.MethodGet, "/internal/v1/tables/"+d.tableID+"/snapshot?viewer="+viewer, nil, &s)
	return s, code
}

func (d *drill) mustSnapshot(n *node, viewer string) snapshot {
	d.t.Helper()
	s, code := d.snapshot(n, viewer)
	if code != http.StatusOK {
		d.t.Fatalf("snapshot from %s: HTTP %d", n.id, code)
	}
	return s
}

// actPassively makes the player to act check or call.
func (d *drill) actPassively(n *node) {
	d.t.Helper()
	pub := d.mustSnapshot(n, "")
	var actor string
	for _, s := range pub.Seats {
		if s.Seat == pub.Hand.ToActSeat {
			actor = s.UserID
		}
	}
	mine := d.mustSnapshot(n, actor)
	kind := "CALL"
	if slices.ContainsFunc(mine.You.LegalActions, func(a legalAction) bool { return a.Kind == "CHECK" }) {
		kind = "CHECK"
	}
	var res struct {
		Accepted bool `json:"accepted"`
	}
	code := d.call(n, http.MethodPost, "/internal/v1/tables/"+d.tableID+"/commands",
		map[string]any{"userId": actor, "commandId": uuid.NewString(), "kind": kind}, &res)
	if code != http.StatusOK || !res.Accepted {
		d.t.Fatalf("%s %s on %s: HTTP %d accepted=%v", actor, kind, n.id, code, res.Accepted)
	}
}

func TestKillGameNodeMidHandResumesOnAnotherNode(t *testing.T) {
	d := newDrill(t)
	a := d.start("node-a")
	b := d.start("node-b")

	// Seating through node A activates the table there.
	for name, seat := range map[string]int{"alice": 1, "bob": 2} {
		code := d.call(a, http.MethodPost, "/internal/v1/tables/"+d.tableID+"/seat",
			map[string]any{"userId": d.users[name], "seatNo": seat, "buyIn": 1000, "requestId": "seat-" + name}, nil)
		if code != http.StatusOK {
			t.Fatalf("seat %s: HTTP %d", name, code)
		}
	}
	d.waitFor("hand on node A", 10*time.Second, func() bool {
		s, code := d.snapshot(a, "")
		return code == http.StatusOK && s.Hand != nil && s.Hand.ToActSeat != 0
	})
	// Preflop call + check, then one flop action: the hand is mid-street.
	for range 3 {
		d.actPassively(a)
	}
	before := map[string]snapshot{}
	for _, name := range []string{"alice", "bob"} {
		before[name] = d.mustSnapshot(a, d.users[name])
	}

	// Crash: no drain, no lease release, no flush.
	if err := a.cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	<-a.exited
	killedAt := time.Now()

	// Node B adopts the orphaned table once the lease expires and replays
	// the persisted actions against the decrypted deck.
	var after snapshot
	d.waitFor("adoption by node B", 15*time.Second, func() bool {
		s, code := d.snapshot(b, d.users["alice"])
		after = s
		return code == http.StatusOK
	})
	t.Logf("node B serving the table %.1fs after the crash", time.Since(killedAt).Seconds())

	bh, ah := before["alice"].Hand, after.Hand
	if ah == nil || ah.HandID != bh.HandID || ah.Pot != bh.Pot || ah.Street != bh.Street ||
		ah.ToActSeat != bh.ToActSeat || !slices.Equal(ah.Board, bh.Board) {
		t.Fatalf("resumed hand differs:\nbefore %+v\nafter  %+v", bh, ah)
	}
	for _, name := range []string{"alice", "bob"} {
		got := d.mustSnapshot(b, d.users[name]).You.HoleCards
		if !slices.Equal(got, before[name].You.HoleCards) {
			t.Fatalf("%s's hole cards changed across failover: %v -> %v", name, before[name].You.HoleCards, got)
		}
	}
	if after.Seq < before["alice"].Seq {
		t.Fatalf("sequence went backwards: %d -> %d", before["alice"].Seq, after.Seq)
	}

	// Finish the hand on node B.
	handID := bh.HandID
	for i := 0; i < 20; i++ {
		s := d.mustSnapshot(b, "")
		if s.Hand == nil || s.Hand.HandID != handID || s.Hand.ToActSeat == 0 {
			break
		}
		d.actPassively(b)
	}
	d.waitFor("settlement", 5*time.Second, func() bool {
		var status string
		_ = d.pool.QueryRow(d.ctx, `SELECT status FROM hands WHERE id = $1`, handID).Scan(&status)
		return status == "COMPLETED"
	})

	// Ownership moved with a higher epoch.
	var owner string
	var epoch int64
	_ = d.pool.QueryRow(d.ctx, `SELECT owner_node_id, epoch FROM table_leases WHERE table_id = $1`, d.tableID).Scan(&owner, &epoch)
	if owner != "node-b" || epoch < 2 {
		t.Fatalf("lease should belong to node-b with a newer epoch, got %s/%d", owner, epoch)
	}

	// The persisted event log is gap-free and the hand was started and
	// settled exactly once.
	var count, minSeq, maxSeq int64
	_ = d.pool.QueryRow(d.ctx, `SELECT count(*), min(seq), max(seq) FROM game_events WHERE table_id = $1`, d.tableID).Scan(&count, &minSeq, &maxSeq)
	if minSeq != 1 || count != maxSeq {
		t.Fatalf("event log has gaps or duplicates: count=%d min=%d max=%d", count, minSeq, maxSeq)
	}
	for kind, want := range map[string]int{"HAND_STARTED": 1, "HAND_COMPLETED": 1, "HAND_VOIDED": 0} {
		var n int
		_ = d.pool.QueryRow(d.ctx, `SELECT count(*) FROM game_events WHERE hand_id = $1 AND event_type = $2`, handID, kind).Scan(&n)
		if n != want {
			t.Fatalf("%s events for the hand = %d, want %d", kind, n, want)
		}
	}

	// Chips: ledger invariants hold, nothing created or destroyed, and the
	// seats agree with the ledger's table-stack accounts.
	violations, err := ledger.Violations(d.ctx, d.pool)
	if err != nil || len(violations) != 0 {
		t.Fatalf("ledger violations: %+v %v", violations, err)
	}
	var total int64
	_ = d.pool.QueryRow(d.ctx, `SELECT coalesce(sum(balance), 0)::bigint FROM ledger_accounts WHERE club_id = $1 AND kind <> 'CLUB_TREASURY'`, d.clubID).Scan(&total)
	if total != d.granted {
		t.Fatalf("chips not conserved: %d in accounts, %d granted", total, d.granted)
	}
	var mismatches int
	_ = d.pool.QueryRow(d.ctx, `
		SELECT count(*) FROM table_seats s
		  JOIN ledger_accounts l ON l.table_id = s.table_id AND l.owner_id = s.user_id AND l.kind = 'TABLE_STACK'
		 WHERE s.table_id = $1 AND s.stack_cached <> l.balance`, d.tableID).Scan(&mismatches)
	if mismatches != 0 {
		t.Fatalf("%d seats disagree with the ledger", mismatches)
	}
	var stacks int64
	for _, s := range d.mustSnapshot(b, "").Seats {
		stacks += s.Stack
	}
	if stacks != 2000 {
		t.Fatalf("table stacks after the hand = %d, want 2000", stacks)
	}
}
