//go:build integration

package ws_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/access"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/auth"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/gamesvc"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/ws"
	ledger "github.com/bar1287/kofclub/go/ledger-client"
	"github.com/bar1287/kofclub/go/pgtest"
)

const internalToken = "gateway-integration-internal-token-0123456789"

var gameBinary string

func TestMain(m *testing.M) {
	dir, _ := os.MkdirTemp("", "kofclub-gw-it")
	gameBinary = filepath.Join(dir, "game-service")
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(file), "../../../..")
	cmd := exec.Command("go", "build", "-o", gameBinary, "./apps/game-service/cmd/game-service")
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "build game-service: %v\n%s", err, out)
		os.Exit(1)
	}
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

// --- environment ----------------------------------------------------------------

type stack struct {
	t       *testing.T
	ctx     context.Context
	pool    *pgxpool.Pool
	priv    ed25519.PrivateKey
	hub     *ws.Hub
	gwURL   string
	gameURL string
	clubID  string
	tableID string
	users   map[string]string
	spec    *openapi3.T
}

type dbChecker struct{ pool *pgxpool.Pool }

// CheckTable mirrors control-api's rule (active member of the table's club);
// the real endpoint is covered by control-api's integration tests.
func (c dbChecker) CheckTable(ctx context.Context, userID, tableID string) (access.Decision, error) {
	var status string
	err := c.pool.QueryRow(ctx, `SELECT m.status FROM tables t JOIN club_members m ON m.club_id = t.club_id
	                             WHERE t.id = $1 AND m.user_id = $2`, tableID, userID).Scan(&status)
	if err != nil {
		return access.Decision{Allowed: false, Code: "NOT_CLUB_MEMBER"}, nil
	}
	if status == "BANNED" {
		return access.Decision{Allowed: false, Code: "CLUB_BANNED"}, nil
	}
	return access.Decision{Allowed: status == "ACTIVE", Code: "NOT_CLUB_MEMBER"}, nil
}

type fakeRevoker struct {
	mu      sync.Mutex
	revoked map[string]bool
}

func (f *fakeRevoker) IsRevoked(_ context.Context, sid string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.revoked[sid]
}

func freePort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func newStack(t *testing.T, cfg ws.Config, revoker ws.Revoker) *stack {
	t.Helper()
	pool, dbURL := pgtest.NewPool(t)
	s := &stack{t: t, ctx: context.Background(), pool: pool, users: map[string]string{}}

	// Game service process.
	port := freePort(t)
	s.gameURL = fmt.Sprintf("http://127.0.0.1:%d", port)
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	cmd := exec.Command(gameBinary)
	cmd.Env = append(os.Environ(),
		"APP_ENV=test", "LOG_LEVEL=error", "DATABASE_URL="+dbURL, fmt.Sprintf("GAME_SERVICE_PORT=%d", port),
		"GAME_NODE_ID=gw-it-node", "GAME_NODE_ADVERTISE_URL="+s.gameURL, "INTERNAL_SERVICE_TOKEN="+internalToken,
		"DECK_ENCRYPTION_KEY_B64="+base64.StdEncoding.EncodeToString(key),
		"HAND_START_DELAY=50ms", "HAND_INTERVAL=150ms", "DRAIN_DELAY=10ms", "DRAIN_TIMEOUT=1s")
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	waitHTTP(t, s.gameURL+"/health/ready")

	// Fixtures.
	for _, n := range []string{"owner", "alice", "bob", "carol", "outsider"} {
		id := uuid.NewString()
		s.exec(`INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, 'x')`, id, n+"@example.test", n)
		s.users[n] = id
	}
	s.clubID = uuid.NewString()
	s.exec(`INSERT INTO clubs (id, owner_user_id, name, join_code) VALUES ($1, $2, 'GW Club', $3)`, s.clubID, s.users["owner"], s.clubID[:8])
	for _, n := range []string{"owner", "alice", "bob", "carol"} {
		role := "MEMBER"
		if n == "owner" {
			role = "OWNER"
		}
		s.exec(`INSERT INTO club_members (club_id, user_id, role) VALUES ($1, $2, $3)`, s.clubID, s.users[n], role)
	}
	s.tableID = uuid.NewString()
	s.exec(`INSERT INTO tables (id, club_id, name, max_seats, small_blind, big_blind, buyin_min, buyin_max, created_by)
	        VALUES ($1, $2, 'GW Table', 6, 5, 10, 100, 5000, $3)`, s.tableID, s.clubID, s.users["owner"])
	treasury, _ := ledger.EnsureAccount(s.ctx, pool, s.clubID, ledger.AccountClubTreasury, s.clubID, "")
	for _, n := range []string{"alice", "bob"} {
		w, _ := ledger.EnsureAccount(s.ctx, pool, s.clubID, ledger.AccountMemberWallet, s.users[n], "")
		if _, err := ledger.Post(s.ctx, pool, ledger.Posting{Kind: ledger.KindClubGrant, ActorType: "SYSTEM", ClubID: s.clubID, ExternalRef: "g:" + n,
			Entries: []ledger.Entry{{AccountID: treasury, Amount: -100000}, {AccountID: w, Amount: 100000}}}); err != nil {
			t.Fatal(err)
		}
	}

	// Gateway hub.
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	s.priv = priv
	der, _ := x509.MarshalPKIXPublicKey(pub)
	verifier, err := auth.NewVerifier(base64.StdEncoding.EncodeToString(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), "iss", "aud")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	s.hub = ws.NewHub(ctx, cfg, verifier, revoker, dbChecker{pool}, gamesvc.New(s.gameURL, internalToken), logger, ws.NewMetrics(prometheus.NewRegistry()))
	mux := http.NewServeMux()
	mux.Handle("GET /ws", s.hub)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	s.gwURL = strings.Replace(srv.URL, "http", "ws", 1) + "/ws"

	_, file, _, _ := runtime.Caller(0)
	s.spec, err = openapi3.NewLoader().LoadFromFile(filepath.Join(filepath.Dir(file), "../../../../packages/contracts/openapi/realtime.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func waitHTTP(t *testing.T, url string) {
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if res, err := http.Get(url); err == nil {
			res.Body.Close()
			if res.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("%s not ready", url)
}

func (s *stack) exec(sql string, args ...any) {
	s.t.Helper()
	if _, err := s.pool.Exec(s.ctx, sql, args...); err != nil {
		s.t.Fatalf("%s: %v", sql, err)
	}
}

func (s *stack) token(user string, exp time.Duration) string {
	tok := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{
		"sub": s.users[user], "sid": "sess-" + user, "prole": "USER", "iss": "iss", "aud": "aud",
		"iat": time.Now().Unix(), "exp": time.Now().Add(exp).Unix(),
	})
	tok.Header["typ"] = "at+jwt"
	str, err := tok.SignedString(s.priv)
	if err != nil {
		s.t.Fatal(err)
	}
	return str
}

func (s *stack) seat(user string, seat int, buyIn int64) {
	s.t.Helper()
	body := fmt.Sprintf(`{"userId":"%s","seatNo":%d,"buyIn":%d,"requestId":"%s"}`, s.users[user], seat, buyIn, uuid.NewString())
	req, _ := http.NewRequest(http.MethodPost, s.gameURL+"/internal/v1/tables/"+s.tableID+"/seat", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+internalToken)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		s.t.Fatalf("seat %s: %d %s", user, res.StatusCode, b)
	}
}

// --- client ---------------------------------------------------------------------

type client struct {
	t      *testing.T
	s      *stack
	conn   *websocket.Conn
	user   string
	frames chan map[string]any
	raw    chan []byte
	closed chan websocket.StatusCode
}

var frameSchemas = map[string]string{
	"WELCOME": "Welcome", "SUBSCRIBED": "Subscribed", "TABLE_SNAPSHOT": "TableSnapshotMessage", "TABLE_EVENT": "TableEventMessage",
	"COMMAND_RESULT": "CommandResult", "RESYNC_REQUIRED": "ResyncRequired", "ERROR": "ProtocolError", "PONG": "Pong",
}

func (s *stack) dial(user string) *client {
	s.t.Helper()
	conn, _, err := websocket.Dial(s.ctx, s.gwURL, nil)
	if err != nil {
		s.t.Fatal(err)
	}
	conn.SetReadLimit(1 << 20)
	c := &client{t: s.t, s: s, conn: conn, user: user, frames: make(chan map[string]any, 4096), raw: make(chan []byte, 4096), closed: make(chan websocket.StatusCode, 1)}
	go func() {
		for {
			_, b, err := conn.Read(context.Background())
			if err != nil {
				c.closed <- websocket.CloseStatus(err)
				close(c.frames)
				return
			}
			var m map[string]any
			if json.Unmarshal(b, &m) != nil {
				continue
			}
			// Contract test: every server frame must match realtime.yaml.
			if name, ok := frameSchemas[m["type"].(string)]; ok {
				var v any
				_ = json.Unmarshal(b, &v)
				if err := s.spec.Components.Schemas[name].Value.VisitJSON(v); err != nil {
					s.t.Errorf("frame does not match realtime.yaml %s: %v\n%s", name, err, b)
				}
			}
			c.raw <- b
			c.frames <- m
		}
	}()
	s.t.Cleanup(func() { _ = conn.CloseNow() })
	return c
}

func (c *client) send(v any) {
	c.t.Helper()
	b, _ := json.Marshal(v)
	if err := c.conn.Write(context.Background(), websocket.MessageText, b); err != nil {
		c.t.Fatal(err)
	}
}

// next returns the next frame of the given type (skipping others when skip=true).
func (c *client) next(typ string, timeout time.Duration) map[string]any {
	c.t.Helper()
	deadline := time.After(timeout)
	var skipped []string
	for {
		select {
		case f, ok := <-c.frames:
			if !ok {
				c.t.Fatalf("%s: connection closed while waiting for %s (skipped %v)", c.user, typ, skipped)
			}
			if f["type"] == typ {
				return f
			}
			desc := fmt.Sprint(f["type"])
			if f["type"] == "ERROR" {
				desc += ":" + fmt.Sprint(f["code"])
			}
			skipped = append(skipped, desc)
		case <-deadline:
			c.t.Fatalf("%s: timed out waiting for %s (skipped %v)", c.user, typ, skipped)
		}
	}
}

func (c *client) hello() map[string]any {
	c.send(map[string]any{"type": "HELLO", "accessToken": c.s.token(c.user, time.Hour), "clientVersion": "test/1"})
	return c.next("WELCOME", 5*time.Second)
}

func (c *client) subscribe(lastSeen *int64) map[string]any {
	m := map[string]any{"type": "SUBSCRIBE_TABLE", "tableId": c.s.tableID, "requestId": "sub-1"}
	if lastSeen != nil {
		m["lastSeenSeq"] = *lastSeen
	}
	c.send(m)
	return c.next("SUBSCRIBED", 10*time.Second)
}

func num(v any) int64 { f, _ := v.(float64); return int64(f) }

// --- tests ------------------------------------------------------------------------

func playHand(t *testing.T, players map[string]*client, observer *client) {
	t.Helper()
	// Drive actions from TURN_STARTED private legal actions until the hand completes.
	for i := 0; i < 60; i++ {
		ev := waitEvent(t, observer, func(e map[string]any) bool {
			k := e["kind"]
			return k == "TURN_STARTED" || k == "HAND_COMPLETED"
		})
		if ev["kind"] == "HAND_COMPLETED" {
			return
		}
		seat := num(ev["seat"])
		var actor *client
		for _, c := range players {
			if seatOf(c) == seat {
				actor = c
			}
		}
		if actor == nil {
			t.Fatalf("no client for seat %d", seat)
		}
		actor.send(map[string]any{"type": "COMMAND", "requestId": uuid.NewString(), "tableId": actor.s.tableID, "command": map[string]any{"kind": "CALL"}})
		res := actor.next("COMMAND_RESULT", 5*time.Second)
		if res["accepted"] != true {
			actor.send(map[string]any{"type": "COMMAND", "requestId": uuid.NewString(), "tableId": actor.s.tableID, "command": map[string]any{"kind": "CHECK"}})
			if res2 := actor.next("COMMAND_RESULT", 5*time.Second); res2["accepted"] != true {
				t.Fatalf("neither CALL nor CHECK accepted: %v / %v", res, res2)
			}
		}
	}
	t.Fatal("hand did not complete")
}

var seatMap sync.Map // user -> seat

func seatOf(c *client) int64 {
	v, _ := seatMap.Load(c.user)
	s, _ := v.(int64)
	return s
}

// waitEvent returns the payload of the next TABLE_EVENT matching pred.
func waitEvent(t *testing.T, c *client, pred func(map[string]any) bool) map[string]any {
	t.Helper()
	for {
		f := c.next("TABLE_EVENT", 10*time.Second)
		ev := f["event"].(map[string]any)
		if pred(ev) {
			return ev
		}
	}
}

func TestTwoClientsSeeIdenticalOrderedStreamAndPrivateCards(t *testing.T) {
	s := newStack(t, ws.DefaultConfig, nil)
	alice, bob, carol := s.dial("alice"), s.dial("bob"), s.dial("carol")
	for _, c := range []*client{alice, bob, carol} {
		c.hello()
		if m := c.subscribe(nil); m["mode"] != "SNAPSHOT" {
			t.Fatalf("initial subscription should be a snapshot: %v", m)
		}
	}
	seatMap.Store("alice", int64(1))
	seatMap.Store("bob", int64(2))
	s.seat("alice", 1, 1000)
	s.seat("bob", 2, 1000)

	// Collect everything carol (a spectating member) sees while the hand plays.
	playHand(t, map[string]*client{"alice": alice, "bob": bob}, carol)

	// Compare the raw TABLE_EVENT streams of all three clients.
	collect := func(c *client) []map[string]any {
		var out []map[string]any
		for {
			select {
			case b := <-c.raw:
				var m map[string]any
				_ = json.Unmarshal(b, &m)
				if m["type"] == "TABLE_EVENT" {
					out = append(out, m)
				}
			case <-time.After(300 * time.Millisecond):
				return out
			}
		}
	}
	streams := map[string][]map[string]any{"alice": collect(alice), "bob": collect(bob), "carol": collect(carol)}
	base := streams["carol"]
	if len(base) < 10 {
		t.Fatalf("too few events: %d", len(base))
	}
	for i := 1; i < len(base); i++ {
		if num(base[i]["seq"]) != num(base[i-1]["seq"])+1 {
			t.Fatalf("gap in carol's stream at %d", i)
		}
	}
	for name, st := range streams {
		if len(st) != len(base) {
			t.Fatalf("%s saw %d events, carol %d", name, len(st), len(base))
		}
		for i := range st {
			if num(st[i]["seq"]) != num(base[i]["seq"]) {
				t.Fatalf("%s seq order differs at %d", name, i)
			}
			pub := base[i]["event"].(map[string]any)
			mine := st[i]["event"].(map[string]any)
			switch pub["kind"] {
			case "HOLE_CARDS_DEALT":
				if _, leaked := pub["cards"]; leaked {
					t.Fatal("spectator received hole cards")
				}
				if name != "carol" {
					if _, ok := mine["cards"]; !ok {
						t.Fatalf("%s did not receive own hole cards", name)
					}
				}
			case "TURN_STARTED":
				if _, leaked := pub["legalActions"]; leaked {
					t.Fatal("spectator received legal actions")
				}
			default:
				a, _ := json.Marshal(pub)
				b, _ := json.Marshal(mine)
				if string(a) != string(b) {
					t.Fatalf("public event differs for %s at seq %d:\n%s\n%s", name, num(st[i]["seq"]), a, b)
				}
			}
		}
	}
	// Alice's cards never appear in bob's stream.
	var aliceCards, bobFrames string
	for _, ev := range streams["alice"] {
		if e := ev["event"].(map[string]any); e["kind"] == "HOLE_CARDS_DEALT" {
			b, _ := json.Marshal(e["cards"])
			aliceCards = string(b)
		}
	}
	for _, ev := range streams["bob"] {
		b, _ := json.Marshal(ev)
		bobFrames += string(b)
	}
	if aliceCards == "" || strings.Contains(bobFrames, aliceCards) {
		t.Fatalf("alice's cards %s leaked to bob or missing", aliceCards)
	}
}

func TestReconnectReplaysMissedEventsAndResyncsOutsideWindow(t *testing.T) {
	cfg := ws.DefaultConfig
	cfg.FeedRing = 6 // small window to exercise RESYNC_REQUIRED
	s := newStack(t, cfg, nil)
	alice, bob, carol := s.dial("alice"), s.dial("bob"), s.dial("carol")
	for _, c := range []*client{alice, bob, carol} {
		c.hello()
		c.subscribe(nil)
	}
	seatMap.Store("alice", int64(1))
	seatMap.Store("bob", int64(2))
	s.seat("alice", 1, 1000)
	s.seat("bob", 2, 1000)

	// Carol watches until the first TURN_STARTED, then drops the connection.
	ev := carol.next("TABLE_EVENT", 10*time.Second)
	lastSeen := num(ev["seq"])
	_ = carol.conn.CloseNow()

	// A few more events happen while carol is away (within the window).
	alice.send(map[string]any{"type": "COMMAND", "requestId": uuid.NewString(), "tableId": s.tableID, "command": map[string]any{"kind": "SIT_OUT"}})
	alice.next("COMMAND_RESULT", 5*time.Second)
	time.Sleep(200 * time.Millisecond)

	carol2 := s.dial("carol")
	carol2.hello()
	sub := carol2.subscribe(&lastSeen)
	if sub["mode"] != "REPLAY" || num(sub["replayed"]) == 0 {
		t.Fatalf("expected a replay: %v", sub)
	}
	// Replayed events start right after lastSeen and are contiguous.
	expect := lastSeen + 1
	for i := int64(0); i < num(sub["replayed"]); i++ {
		b := <-carol2.raw
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		for m["type"] != "TABLE_EVENT" {
			b = <-carol2.raw
			_ = json.Unmarshal(b, &m)
		}
		if num(m["seq"]) != expect {
			t.Fatalf("replay seq %d, want %d", num(m["seq"]), expect)
		}
		expect++
	}

	// Push the table well past the 6-event window.
	for i := 0; i < 8; i++ {
		kind := "SIT_IN"
		if i%2 == 1 {
			kind = "SIT_OUT"
		}
		alice.send(map[string]any{"type": "COMMAND", "requestId": uuid.NewString(), "tableId": s.tableID, "command": map[string]any{"kind": kind}})
		if r := alice.next("COMMAND_RESULT", 5*time.Second); r["accepted"] != true {
			t.Fatalf("%s rejected: %v", kind, r)
		}
	}
	time.Sleep(200 * time.Millisecond)

	// Far behind the retained window: explicit resync with a fresh snapshot.
	carol3 := s.dial("carol")
	carol3.hello()
	zero := int64(0)
	carol3.send(map[string]any{"type": "SUBSCRIBE_TABLE", "tableId": s.tableID, "lastSeenSeq": zero})
	rs := carol3.next("RESYNC_REQUIRED", 10*time.Second)
	if rs["reason"] != "EVENTS_NOT_RETAINED" {
		t.Fatalf("resync reason %v", rs["reason"])
	}
	snap := carol3.next("TABLE_SNAPSHOT", 10*time.Second)
	if num(snap["seq"]) < expect-1 {
		t.Fatalf("snapshot seq %d behind replayed seq %d", num(snap["seq"]), expect-1)
	}
	if m := carol3.next("SUBSCRIBED", 5*time.Second); m["mode"] != "SNAPSHOT" {
		t.Fatalf("expected snapshot mode: %v", m)
	}
}

func TestCommandsAreIdempotentAndStaleSeqIsRejected(t *testing.T) {
	s := newStack(t, ws.DefaultConfig, nil)
	alice, bob := s.dial("alice"), s.dial("bob")
	alice.hello()
	bob.hello()
	alice.subscribe(nil)
	bob.subscribe(nil)
	s.seat("alice", 1, 1000)
	s.seat("bob", 2, 1000)
	turn := waitEvent(t, alice, func(e map[string]any) bool { return e["kind"] == "TURN_STARTED" })
	actor := alice
	if num(turn["seat"]) == 2 {
		actor = bob
	}

	stale := int64(1)
	actor.send(map[string]any{"type": "COMMAND", "requestId": uuid.NewString(), "tableId": s.tableID, "expectedSeq": stale, "command": map[string]any{"kind": "CALL"}})
	res := actor.next("COMMAND_RESULT", 5*time.Second)
	if res["accepted"] == true || res["error"].(map[string]any)["code"] != "STALE_GAME_STATE" {
		t.Fatalf("stale expectedSeq must be rejected: %v", res)
	}

	id := uuid.NewString()
	cmd := map[string]any{"type": "COMMAND", "requestId": id, "tableId": s.tableID, "command": map[string]any{"kind": "CALL"}}
	actor.send(cmd)
	first := actor.next("COMMAND_RESULT", 5*time.Second)
	actor.send(cmd)
	second := actor.next("COMMAND_RESULT", 5*time.Second)
	if first["accepted"] != true || second["duplicate"] != true || num(first["seq"]) != num(second["seq"]) {
		t.Fatalf("duplicate handling: %v / %v", first, second)
	}
	var n int
	_ = s.pool.QueryRow(s.ctx, `SELECT count(*) FROM table_commands WHERE command_id = $1`, id).Scan(&n)
	if n != 1 {
		t.Fatalf("command applied %d times", n)
	}

	// Garbage commands are rejected without reaching the table.
	actor.send(map[string]any{"type": "COMMAND", "requestId": "nope", "tableId": s.tableID, "command": map[string]any{"kind": "CALL"}})
	if r := actor.next("COMMAND_RESULT", 5*time.Second); r["error"].(map[string]any)["code"] != "VALIDATION_FAILED" {
		t.Fatalf("invalid command: %v", r)
	}
}

func TestUnauthorizedSubscriptionAndAuthenticationFailures(t *testing.T) {
	cfg := ws.DefaultConfig
	cfg.HelloTimeout = 300 * time.Millisecond
	revoker := &fakeRevoker{revoked: map[string]bool{"sess-bob": true}}
	s := newStack(t, cfg, revoker)

	outsider := s.dial("outsider")
	outsider.hello()
	outsider.send(map[string]any{"type": "SUBSCRIBE_TABLE", "tableId": s.tableID})
	if e := outsider.next("ERROR", 5*time.Second); e["code"] != "NOT_CLUB_MEMBER" {
		t.Fatalf("outsider subscribe: %v", e)
	}
	outsider.send(map[string]any{"type": "COMMAND", "requestId": uuid.NewString(), "tableId": s.tableID, "command": map[string]any{"kind": "FOLD"}})
	if r := outsider.next("COMMAND_RESULT", 5*time.Second); r["error"].(map[string]any)["code"] != "NOT_CLUB_MEMBER" {
		t.Fatalf("outsider command: %v", r)
	}

	expectClose := func(c *client, code websocket.StatusCode) {
		t.Helper()
		select {
		case got := <-c.closed:
			if got != code {
				t.Fatalf("close code %d, want %d", got, code)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("connection was not closed")
		}
	}

	bad := s.dial("alice")
	bad.send(map[string]any{"type": "HELLO", "accessToken": "garbage", "clientVersion": "t"})
	expectClose(bad, 4401)

	expired := s.dial("alice")
	expired.send(map[string]any{"type": "HELLO", "accessToken": s.token("alice", -time.Minute), "clientVersion": "t"})
	expectClose(expired, 4401)

	noHello := s.dial("alice")
	noHello.send(map[string]any{"type": "SUBSCRIBE_TABLE", "tableId": s.tableID})
	expectClose(noHello, 4401)

	silent := s.dial("alice")
	expectClose(silent, 4408)

	revoked := s.dial("bob")
	revoked.send(map[string]any{"type": "HELLO", "accessToken": s.token("bob", time.Hour), "clientVersion": "t"})
	expectClose(revoked, 4401)

	// A live session is closed as soon as it is revoked.
	live := s.dial("alice")
	live.hello()
	s.hub.RevokeSession("sess-alice")
	expectClose(live, 4401)

	// PING/PONG keepalive.
	carol := s.dial("carol")
	carol.hello()
	carol.send(map[string]any{"type": "PING", "nonce": "n1"})
	if p := carol.next("PONG", 5*time.Second); p["nonce"] != "n1" {
		t.Fatalf("pong: %v", p)
	}
}
