// Command loadsmoke is a short synthetic load test (spec §15, `make
// load-smoke`). It creates a club with bot players seated at several
// tables, plays through the real control API and realtime gateway for a
// fixed duration, then has every bot leave and verifies the club's ledger
// reconciles. It reports command round-trip latency, rejections and resyncs
// and exits non-zero when a threshold is exceeded.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	mrand "math/rand/v2"
	"net/http"
	"os"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type config struct {
	api, ws        string
	game           string
	tables, seats  int
	duration       time.Duration
	maxP95         time.Duration
	maxErrorRate   float64
	thinkMin       time.Duration
	thinkMax       time.Duration
	leaveTimeout   time.Duration
	requestTimeout time.Duration
}

func main() {
	var c config
	flag.StringVar(&c.api, "api", env("LOAD_API_URL", "http://localhost:4000"), "control API base URL")
	flag.StringVar(&c.ws, "ws", env("LOAD_WS_URL", "ws://localhost:4100/ws"), "realtime gateway URL")
	flag.IntVar(&c.tables, "tables", 4, "number of tables")
	flag.StringVar(&c.game, "game", "NLHE", "table game: NLHE, PLO or MIXED (alternating)")
	flag.IntVar(&c.seats, "players", 3, "bot players per table (2-6)")
	flag.DurationVar(&c.duration, "duration", 30*time.Second, "how long bots play before leaving")
	flag.DurationVar(&c.maxP95, "max-p95", 250*time.Millisecond, "fail if command round-trip p95 exceeds this")
	flag.Float64Var(&c.maxErrorRate, "max-error-rate", 0.01, "fail if unexpected command errors exceed this share")
	flag.DurationVar(&c.thinkMin, "think-min", 50*time.Millisecond, "minimum bot think time")
	flag.DurationVar(&c.thinkMax, "think-max", 300*time.Millisecond, "maximum bot think time")
	flag.DurationVar(&c.leaveTimeout, "leave-timeout", 90*time.Second, "time allowed for bots to finish hands and leave")
	flag.Parse()
	if c.game != "NLHE" && c.game != "PLO" && c.game != "MIXED" {
		fmt.Fprintln(os.Stderr, "-game must be NLHE, PLO or MIXED")
		os.Exit(2)
	}
	c.requestTimeout = 10 * time.Second
	if c.seats < 2 || c.seats > 6 || c.tables < 1 {
		fail("players must be 2-6 and tables >= 1")
	}
	if err := run(c); err != nil {
		fail(err.Error())
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "loadsmoke: FAIL:", msg)
	os.Exit(1)
}

// --- HTTP ------------------------------------------------------------------

type account struct {
	ID       string
	Username string
	Token    string
}

type apiError struct {
	Status int
	Code   string
	Msg    string
}

func (e *apiError) Error() string { return fmt.Sprintf("HTTP %d %s: %s", e.Status, e.Code, e.Msg) }

func (c config) call(token, method, path string, body, out any, headers ...string) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	ctx, cancel := context.WithTimeout(context.Background(), c.requestTimeout)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.api, "/")+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		var env struct {
			Error struct{ Code, Message string } `json:"error"`
		}
		_ = json.Unmarshal(data, &env)
		return &apiError{Status: res.StatusCode, Code: env.Error.Code, Msg: env.Error.Message}
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (c config) register(prefix string) (account, error) {
	name := fmt.Sprintf("%s_%s", prefix, randomHex(4))
	var res struct {
		AccessToken string `json:"accessToken"`
		User        struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	err := c.call("", http.MethodPost, "/v1/auth/register",
		map[string]string{"email": name + "@load.test", "username": name, "password": "load-" + randomHex(8)}, &res)
	return account{ID: res.User.ID, Username: name, Token: res.AccessToken}, err
}

// --- bots ------------------------------------------------------------------

type legalAction struct {
	Kind  string `json:"kind"`
	MinTo int64  `json:"minTo"`
	MaxTo int64  `json:"maxTo"`
}

type frame struct {
	Type      string          `json:"type"`
	TableID   string          `json:"tableId"`
	Seq       int64           `json:"seq"`
	RequestID string          `json:"requestId"`
	Accepted  bool            `json:"accepted"`
	Duplicate bool            `json:"duplicate"`
	Code      string          `json:"code"`
	Message   string          `json:"message"`
	Reason    string          `json:"reason"`
	Event     json.RawMessage `json:"event"`
	Snapshot  json.RawMessage `json:"snapshot"`
	Error     *struct {
		Code string `json:"code"`
	} `json:"error"`
}

type event struct {
	Kind         string        `json:"kind"`
	Seat         int           `json:"seat"`
	UserID       string        `json:"userId"`
	LegalActions []legalAction `json:"legalActions"`
}

type snapshotView struct {
	You *struct {
		Seat         int           `json:"seat"`
		LegalActions []legalAction `json:"legalActions"`
	} `json:"you"`
	Hand *struct {
		ToActSeat int `json:"toActSeat"`
	} `json:"hand"`
}

type stats struct {
	mu          sync.Mutex
	rtts        []time.Duration
	commands    atomic.Int64
	accepted    atomic.Int64
	rejected    sync.Map // code -> *atomic.Int64
	unexpected  atomic.Int64
	resyncs     atomic.Int64
	protoErrors atomic.Int64
	hands       atomic.Int64
}

func (s *stats) reject(code string) {
	v, _ := s.rejected.LoadOrStore(code, new(atomic.Int64))
	v.(*atomic.Int64).Add(1)
}

// Expected rejections: races between a bot's decision and the hand moving
// on (timeouts, other players) are part of normal play.
var benign = map[string]bool{"STALE_GAME_STATE": true, "NOT_YOUR_TURN": true, "HAND_NOT_ACTIVE": true}

type bot struct {
	cfg     config
	acct    account
	tableID string
	st      *stats
	counter bool // counts completed hands for its table

	conn    *websocket.Conn
	writeMu sync.Mutex
	seat    int
	lastSeq atomic.Int64
	pending sync.Map // requestId -> sent time
	turns   chan []legalAction
	left    chan struct{}
	stopAct atomic.Bool
}

func (b *bot) send(ctx context.Context, v any) error {
	b.writeMu.Lock()
	defer b.writeMu.Unlock()
	wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return wsjson.Write(wctx, b.conn, v)
}

func (b *bot) connect(ctx context.Context) error {
	// Non-browser client: no Origin header (browsers are checked against CORS_ORIGINS).
	conn, _, err := websocket.Dial(ctx, b.cfg.ws, nil)
	if err != nil {
		return err
	}
	conn.SetReadLimit(1 << 20)
	b.conn = conn
	if err := b.send(ctx, map[string]string{"type": "HELLO", "accessToken": b.acct.Token, "clientVersion": "loadsmoke"}); err != nil {
		return err
	}
	var welcome frame
	if err := wsjson.Read(ctx, conn, &welcome); err != nil || welcome.Type != "WELCOME" {
		return fmt.Errorf("handshake: %v %+v", err, welcome)
	}
	return b.send(ctx, map[string]string{"type": "SUBSCRIBE_TABLE", "tableId": b.tableID})
}

// read dispatches frames until the connection closes.
func (b *bot) read(ctx context.Context) {
	for {
		var f frame
		if err := wsjson.Read(ctx, b.conn, &f); err != nil {
			return
		}
		switch f.Type {
		case "TABLE_SNAPSHOT":
			b.lastSeq.Store(f.Seq)
			var s snapshotView
			_ = json.Unmarshal(f.Snapshot, &s)
			if s.You != nil {
				b.seat = s.You.Seat
				if s.Hand != nil && s.Hand.ToActSeat == s.You.Seat && len(s.You.LegalActions) > 0 {
					b.offer(s.You.LegalActions)
				}
			}
		case "TABLE_EVENT":
			b.lastSeq.Store(f.Seq)
			var ev event
			_ = json.Unmarshal(f.Event, &ev)
			switch ev.Kind {
			case "TURN_STARTED":
				if ev.Seat == b.seat && len(ev.LegalActions) > 0 {
					b.offer(ev.LegalActions)
				}
			case "HAND_COMPLETED", "HAND_VOIDED":
				if b.counter {
					b.st.hands.Add(1)
				}
			case "PLAYER_LEFT":
				if ev.UserID == b.acct.ID {
					close(b.left)
				}
			}
		case "COMMAND_RESULT":
			if sent, ok := b.pending.LoadAndDelete(f.RequestID); ok {
				b.st.mu.Lock()
				b.st.rtts = append(b.st.rtts, time.Since(sent.(time.Time)))
				b.st.mu.Unlock()
			}
			if f.Accepted {
				b.st.accepted.Add(1)
			} else if f.Error != nil {
				b.st.reject(f.Error.Code)
				if !benign[f.Error.Code] {
					b.st.unexpected.Add(1)
				}
			}
		case "RESYNC_REQUIRED":
			b.st.resyncs.Add(1)
		case "ERROR":
			b.st.protoErrors.Add(1)
		}
	}
}

func (b *bot) offer(legal []legalAction) {
	select {
	case b.turns <- legal:
	default: // a newer turn replaces nothing; the bot acts on the first
	}
}

func choose(legal []legalAction) map[string]any {
	has := func(kind string) *legalAction {
		for i := range legal {
			if legal[i].Kind == kind {
				return &legal[i]
			}
		}
		return nil
	}
	r := mrand.Float64()
	switch {
	case r < 0.08 && has("FOLD") != nil && has("CHECK") == nil:
		return map[string]any{"kind": "FOLD"}
	case r < 0.18 && has("RAISE") != nil:
		return map[string]any{"kind": "RAISE", "amount": has("RAISE").MinTo}
	case r < 0.18 && has("BET") != nil:
		return map[string]any{"kind": "BET", "amount": has("BET").MinTo}
	case has("CHECK") != nil:
		return map[string]any{"kind": "CHECK"}
	case has("CALL") != nil:
		return map[string]any{"kind": "CALL"}
	default:
		return map[string]any{"kind": "FOLD"}
	}
}

// act answers turns until stopped.
func (b *bot) act(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case legal := <-b.turns:
			think := b.cfg.thinkMin + time.Duration(mrand.Int64N(int64(b.cfg.thinkMax-b.cfg.thinkMin)+1))
			select {
			case <-ctx.Done():
				return
			case <-time.After(think):
			}
			if b.stopAct.Load() {
				continue // leaving: the server acts for departing players
			}
			id := randomUUID()
			b.pending.Store(id, time.Now())
			b.st.commands.Add(1)
			err := b.send(ctx, map[string]any{
				"type": "COMMAND", "requestId": id, "tableId": b.tableID,
				"expectedSeq": b.lastSeq.Load(), "command": choose(legal),
			})
			if err != nil {
				b.st.unexpected.Add(1)
			}
		}
	}
}

func randomUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// --- scenario --------------------------------------------------------------

func run(c config) error {
	start := time.Now()
	owner, err := c.register("owner")
	if err != nil {
		return fmt.Errorf("register owner: %w", err)
	}
	var club struct {
		ID       string `json:"id"`
		JoinCode string `json:"joinCode"`
	}
	if err := c.call(owner.Token, http.MethodPost, "/v1/clubs", map[string]string{"name": "Load " + randomHex(3)}, &club); err != nil {
		return fmt.Errorf("create club: %w", err)
	}
	tableIDs := make([]string, c.tables)
	for i := range tableIDs {
		var t struct {
			ID string `json:"id"`
		}
		game := c.game
		if game == "MIXED" {
			game = []string{"NLHE", "PLO"}[i%2]
		}
		if err := c.call(owner.Token, http.MethodPost, "/v1/clubs/"+club.ID+"/tables", map[string]any{
			"name": fmt.Sprintf("Load %d", i+1), "gameType": game, "maxSeats": 6, "smallBlind": 5, "bigBlind": 10,
			"buyInMin": 200, "buyInMax": 2000, "actionTimeoutSec": 20,
		}, &t); err != nil {
			return fmt.Errorf("create table: %w", err)
		}
		tableIDs[i] = t.ID
	}

	st := &stats{}
	var bots []*bot
	var mu sync.Mutex
	var wg sync.WaitGroup
	setupErr := make(chan error, c.tables*c.seats)
	for _, tableID := range tableIDs {
		for si := 0; si < c.seats; si++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				acct, err := c.register("bot")
				if err == nil {
					err = c.call(acct.Token, http.MethodPost, "/v1/clubs/join", map[string]string{"code": club.JoinCode}, nil)
				}
				if err == nil {
					err = c.call(owner.Token, http.MethodPost, "/v1/clubs/"+club.ID+"/chips/grants",
						map[string]any{"userId": acct.ID, "amount": 10_000}, nil, "Idempotency-Key", "load-"+acct.ID)
				}
				if err == nil {
					err = c.call(acct.Token, http.MethodPost, "/v1/tables/"+tableID+"/seat",
						map[string]any{"seatNo": si + 1, "buyIn": 1000}, nil, "Idempotency-Key", "seat-"+acct.ID)
				}
				if err != nil {
					setupErr <- fmt.Errorf("bot setup: %w", err)
					return
				}
				mu.Lock()
				bots = append(bots, &bot{cfg: c, acct: acct, tableID: tableID, st: st, counter: si == 0,
					turns: make(chan []legalAction, 1), left: make(chan struct{})})
				mu.Unlock()
			}()
		}
	}
	wg.Wait()
	close(setupErr)
	if err := <-setupErr; err != nil {
		return err
	}
	fmt.Printf("setup: %d tables, %d bots in %.1fs\n", c.tables, len(bots), time.Since(start).Seconds())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for _, b := range bots {
		if err := b.connect(ctx); err != nil {
			return fmt.Errorf("connect %s: %w", b.acct.Username, err)
		}
		go b.read(ctx)
		go b.act(ctx)
	}

	playStart := time.Now()
	time.Sleep(c.duration)
	played := time.Since(playStart)

	// Leave: immediately, or after the current hand (the server checks or
	// folds for departing players without waiting for the turn timer).
	for _, b := range bots {
		b.stopAct.Store(true)
	}
	for _, b := range bots {
		var res struct {
			Status string `json:"status"`
		}
		if err := c.call(b.acct.Token, http.MethodPost, "/v1/tables/"+b.tableID+"/leave", nil, &res,
			"Idempotency-Key", "leave-"+b.acct.ID); err != nil {
			var ae *apiError
			if !errors.As(err, &ae) || ae.Code != "PLAYER_NOT_SEATED" {
				return fmt.Errorf("leave: %w", err)
			}
		}
	}
	deadline := time.After(c.leaveTimeout)
	for _, b := range bots {
		select {
		case <-b.left:
		case <-deadline:
			return errors.New("bots did not all leave in time")
		}
	}
	cancel()

	// The club ledger must reconcile: everything issued is back in wallets.
	var summary struct {
		Issued    int64 `json:"issued"`
		InWallets int64 `json:"inWallets"`
		AtTables  int64 `json:"atTables"`
	}
	if err := c.call(owner.Token, http.MethodGet, "/v1/clubs/"+club.ID+"/ledger/summary", nil, &summary); err != nil {
		return fmt.Errorf("ledger summary: %w", err)
	}

	return report(c, st, played, len(bots), summary.Issued, summary.InWallets, summary.AtTables)
}

func percentile(sorted []time.Duration, p float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(p*float64(len(sorted)))) - 1
	return sorted[max(0, min(idx, len(sorted)-1))]
}

func report(c config, st *stats, played time.Duration, bots int, issued, inWallets, atTables int64) error {
	st.mu.Lock()
	rtts := slices.Clone(st.rtts)
	st.mu.Unlock()
	sort.Slice(rtts, func(i, j int) bool { return rtts[i] < rtts[j] })
	p50, p95, p99 := percentile(rtts, 0.5), percentile(rtts, 0.95), percentile(rtts, 0.99)
	commands := st.commands.Load()
	fmt.Printf("played %.0fs: %d bots, %d hands (%.2f hands/s), %d commands (%.1f/s), %d accepted\n",
		played.Seconds(), bots, st.hands.Load(), float64(st.hands.Load())/played.Seconds(),
		commands, float64(commands)/played.Seconds(), st.accepted.Load())
	fmt.Printf("command round trip: p50 %v, p95 %v, p99 %v, max %v (n=%d)\n",
		p50.Round(time.Microsecond), p95.Round(time.Microsecond), p99.Round(time.Microsecond),
		percentile(rtts, 1).Round(time.Microsecond), len(rtts))
	var rejected []string
	st.rejected.Range(func(k, v any) bool {
		rejected = append(rejected, fmt.Sprintf("%s=%d", k, v.(*atomic.Int64).Load()))
		return true
	})
	sort.Strings(rejected)
	fmt.Printf("rejections: %v; unexpected errors: %d; resyncs: %d; protocol errors: %d\n",
		rejected, st.unexpected.Load(), st.resyncs.Load(), st.protoErrors.Load())
	fmt.Printf("ledger: issued %d, in wallets %d, at tables %d\n", issued, inWallets, atTables)

	var problems []string
	if commands == 0 || st.hands.Load() == 0 {
		problems = append(problems, "no hands were played")
	}
	if commands > 0 && float64(st.unexpected.Load()+st.protoErrors.Load())/float64(commands) > c.maxErrorRate {
		problems = append(problems, "error rate above threshold")
	}
	if p95 > c.maxP95 {
		problems = append(problems, fmt.Sprintf("p95 %v above %v", p95, c.maxP95))
	}
	if issued != inWallets || atTables != 0 {
		problems = append(problems, "ledger does not reconcile")
	}
	if len(problems) > 0 {
		return errors.New(strings.Join(problems, "; "))
	}
	fmt.Println("loadsmoke: OK")
	return nil
}
