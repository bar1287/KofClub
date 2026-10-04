package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	tournamentBuyIn = 100
	tournamentStack = 1000
)

type tournamentDetail struct {
	Status     string        `json:"status"`
	PrizePool  int64         `json:"prizePool"`
	MyTableID  string        `json:"myTableId"`
	StartedAt  string        `json:"startedAt"`
	FinishedAt string        `json:"finishedAt"`
	Entrants   []entrantView `json:"entrants"`
}

type entrantView struct {
	UserID string `json:"userId"`
	Place  *int   `json:"place"`
	Prize  int64  `json:"prize"`
}

// runTournaments plays c.tournaments sit-and-gos with bots through the
// public API and the realtime gateway, then verifies results and ledger.
func runTournaments(c config) error {
	start := time.Now()
	owner, err := c.register("owner")
	if err != nil {
		return fmt.Errorf("register owner: %w", err)
	}
	var club struct {
		ID       string `json:"id"`
		JoinCode string `json:"joinCode"`
	}
	if err := c.call(owner.Token, http.MethodPost, "/v1/clubs", map[string]string{"name": "Load Cups " + randomHex(3)}, &club); err != nil {
		return fmt.Errorf("create club: %w", err)
	}
	ids := make([]string, c.tournaments)
	for i := range ids {
		var t struct {
			ID string `json:"id"`
		}
		if err := c.call(owner.Token, http.MethodPost, "/v1/clubs/"+club.ID+"/tournaments", map[string]any{
			"name": fmt.Sprintf("Load Cup %d", i+1), "buyIn": tournamentBuyIn, "startingStack": tournamentStack,
			"smallBlind": 10, "bigBlind": 20, "levelDurationSec": int(c.tournamentLevel.Seconds()),
			"seatsPerTable": c.tournamentSeats, "minPlayers": 2, "maxPlayers": c.tournamentPlayers,
			"startMode": "SIT_AND_GO", "actionTimeoutSec": 20,
		}, &t); err != nil {
			return fmt.Errorf("create tournament: %w", err)
		}
		ids[i] = t.ID
	}

	// Bots join the club, receive chips and register (the last registration
	// of each tournament fills it and the game service starts it).
	st := &stats{}
	type entrant struct {
		b          *bot
		tournament string
	}
	var entrants []entrant
	var mu sync.Mutex
	var wg sync.WaitGroup
	setupErr := make(chan error, c.tournaments*c.tournamentPlayers)
	for _, tid := range ids {
		for range c.tournamentPlayers {
			wg.Add(1)
			go func() {
				defer wg.Done()
				acct, err := c.register("bot")
				if err == nil {
					err = c.call(acct.Token, http.MethodPost, "/v1/clubs/join", map[string]string{"code": club.JoinCode}, nil)
				}
				if err == nil {
					err = c.call(owner.Token, http.MethodPost, "/v1/clubs/"+club.ID+"/chips/grants",
						map[string]any{"userId": acct.ID, "amount": 1_000}, nil, "Idempotency-Key", "load-"+acct.ID)
				}
				if err == nil {
					err = c.call(acct.Token, http.MethodPost, "/v1/tournaments/"+tid+"/register", nil, nil)
				}
				if err != nil {
					setupErr <- fmt.Errorf("bot setup: %w", err)
					return
				}
				mu.Lock()
				entrants = append(entrants, entrant{tournament: tid, b: &bot{cfg: c, acct: acct, st: st,
					turns: make(chan []legalAction, 1), left: make(chan struct{})}})
				mu.Unlock()
			}()
		}
	}
	wg.Wait()
	close(setupErr)
	if err := <-setupErr; err != nil {
		return err
	}
	fmt.Printf("setup: %d tournaments x %d players (%d-handed tables) in %.1fs\n",
		c.tournaments, c.tournamentPlayers, c.tournamentSeats, time.Since(start).Seconds())

	// Every bot finds its table once its tournament runs and connects.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	playStart := time.Now()
	errs := make(chan error, len(entrants))
	for _, e := range entrants {
		wg.Add(1)
		go func() {
			defer wg.Done()
			deadline := time.Now().Add(30 * time.Second)
			for {
				var d tournamentDetail
				if err := c.call(e.b.acct.Token, http.MethodGet, "/v1/tournaments/"+e.tournament, nil, &d); err != nil {
					errs <- err
					return
				}
				if d.MyTableID != "" {
					e.b.tableID = d.MyTableID
					break
				}
				if d.Status == "FINISHED" || time.Now().After(deadline) {
					errs <- fmt.Errorf("tournament %s did not seat %s (status %s)", e.tournament, e.b.acct.Username, d.Status)
					return
				}
				time.Sleep(250 * time.Millisecond)
			}
			if err := e.b.connect(ctx); err != nil {
				errs <- fmt.Errorf("connect %s: %w", e.b.acct.Username, err)
				return
			}
			go e.b.read(ctx)
			go e.b.act(ctx)
			go e.b.follow(ctx, e.tournament)
		}()
	}
	wg.Wait()
	close(errs)
	if err := <-errs; err != nil {
		return err
	}

	// Wait for every tournament to finish.
	durations := map[string]time.Duration{}
	deadline := time.Now().Add(c.tournamentTimeout)
	for len(durations) < len(ids) {
		if time.Now().After(deadline) {
			return fmt.Errorf("%d of %d tournaments finished within %v", len(durations), len(ids), c.tournamentTimeout)
		}
		for _, tid := range ids {
			if _, done := durations[tid]; done {
				continue
			}
			var d tournamentDetail
			if err := c.call(owner.Token, http.MethodGet, "/v1/tournaments/"+tid, nil, &d); err != nil {
				return err
			}
			if d.Status == "FINISHED" {
				started, _ := time.Parse(time.RFC3339Nano, d.StartedAt)
				finished, _ := time.Parse(time.RFC3339Nano, d.FinishedAt)
				durations[tid] = finished.Sub(started)
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	played := time.Since(playStart)

	// Every bot learned how its tournament ended for it (eliminated or won)
	// from the table it was watching: none lost track of its table.
	lost := 0
	departed := time.After(10 * time.Second)
	for _, e := range entrants {
		select {
		case <-e.b.left:
		case <-departed:
			lost++
		}
	}
	cancel()

	// Results: everyone placed, one winner, prizes = pool = buy-ins.
	var problems []string
	for _, tid := range ids {
		var d tournamentDetail
		if err := c.call(owner.Token, http.MethodGet, "/v1/tournaments/"+tid, nil, &d); err != nil {
			return err
		}
		var prizes int64
		winners, unplaced := 0, 0
		for _, e := range d.Entrants {
			prizes += e.Prize
			switch {
			case e.Place == nil:
				unplaced++
			case *e.Place == 1:
				winners++
			}
		}
		want := int64(c.tournamentPlayers * tournamentBuyIn)
		if d.PrizePool != want || prizes != want || winners != 1 || unplaced != 0 || len(d.Entrants) != c.tournamentPlayers {
			problems = append(problems, fmt.Sprintf("tournament %s: pool %d prizes %d winners %d unplaced %d entrants %d",
				tid, d.PrizePool, prizes, winners, unplaced, len(d.Entrants)))
		}
	}
	var summary struct {
		Issued        int64 `json:"issued"`
		InWallets     int64 `json:"inWallets"`
		AtTables      int64 `json:"atTables"`
		InTournaments int64 `json:"inTournaments"`
	}
	if err := c.call(owner.Token, http.MethodGet, "/v1/clubs/"+club.ID+"/ledger/summary", nil, &summary); err != nil {
		return fmt.Errorf("ledger summary: %w", err)
	}
	if summary.Issued != summary.InWallets || summary.AtTables != 0 || summary.InTournaments != 0 {
		problems = append(problems, fmt.Sprintf("ledger does not reconcile: %+v", summary))
	}

	var hands int
	st.handIDs.Range(func(any, any) bool { hands++; return true })
	ds := make([]time.Duration, 0, len(durations))
	for _, d := range durations {
		ds = append(ds, d)
	}
	slices.Sort(ds)
	fmt.Printf("played %.0fs: %d tournaments finished (fastest %v, slowest %v), %d hands, %d moves, %d commands, %d accepted\n",
		played.Seconds(), len(durations), ds[0].Round(time.Second), ds[len(ds)-1].Round(time.Second),
		hands, st.moves.Load(), st.commands.Load(), st.accepted.Load())
	fmt.Printf("learned from the tournament API instead of an event: %d moves, %d results\n",
		st.refollows.Load(), st.lateResults.Load())
	p95 := latencyReport(st)
	fmt.Printf("ledger: issued %d, in wallets %d, at tables %d, in tournaments %d\n",
		summary.Issued, summary.InWallets, summary.AtTables, summary.InTournaments)

	if commands := st.commands.Load(); commands == 0 || hands == 0 {
		problems = append(problems, "no hands were played")
	} else if float64(st.unexpected.Load()+st.protoErrors.Load())/float64(commands) > c.maxErrorRate {
		problems = append(problems, "error rate above threshold")
	}
	if lost > 0 {
		problems = append(problems, fmt.Sprintf("%d bots never learned their elimination or win", lost))
	}
	if p95 > c.maxP95 {
		problems = append(problems, fmt.Sprintf("p95 %v above %v", p95, c.maxP95))
	}
	if len(problems) > 0 {
		return errors.New(strings.Join(problems, "; "))
	}
	fmt.Println("loadsmoke: OK")
	return nil
}

// follow re-checks where an unseated bot plays, as the web client does: a
// bot that subscribes just after a table moved it on (or redirected it
// before it arrived) only gets a snapshot without itself and no event.
func (b *bot) follow(ctx context.Context, tournament string) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-b.left:
			return
		case <-t.C:
		}
		if b.seat.Load() != 0 {
			continue
		}
		var d tournamentDetail
		if err := b.cfg.call(b.acct.Token, http.MethodGet, "/v1/tournaments/"+tournament, nil, &d); err != nil {
			continue
		}
		switch {
		case b.seat.Load() != 0:
		case d.MyTableID == "" && slices.ContainsFunc(d.Entrants, func(e entrantView) bool { return e.UserID == b.acct.ID && e.Place != nil }):
			// Out (or the winner) before the bot reached its last table.
			b.st.lateResults.Add(1)
			b.leave()
			return
		case d.Status == "RUNNING" && d.MyTableID != "" && d.MyTableID != b.table():
			b.st.refollows.Add(1)
			b.move(ctx, d.MyTableID)
		}
	}
}

// latencyReport prints command round trips, rejections and continuity
// problems and returns the p95.
func latencyReport(st *stats) time.Duration {
	st.mu.Lock()
	rtts := slices.Clone(st.rtts)
	st.mu.Unlock()
	sort.Slice(rtts, func(i, j int) bool { return rtts[i] < rtts[j] })
	p50, p95, p99 := percentile(rtts, 0.5), percentile(rtts, 0.95), percentile(rtts, 0.99)
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
	return p95
}
