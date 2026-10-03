// Package table implements the authoritative table actor (spec §4.1): one
// goroutine per table processes every command, timer and query
// sequentially, applies it to the pure engine, persists the resulting
// events under the table lease, and only then publishes them.
package table

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/bar1287/kofclub/apps/game-service/internal/sealer"
	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/go/poker"
)

// Timing controls actor pacing.
type Timing struct {
	// StartDelay is the pause before the first hand once enough players sit.
	StartDelay time.Duration
	// HandInterval is the pause between hands (results display).
	HandInterval time.Duration
	// RetryBackoff is the wait before retrying a failed durable write.
	RetryBackoff time.Duration
	// MaxTimeouts is the number of consecutive timeouts before a player is
	// sat out automatically.
	MaxTimeouts int
	// ActionTimeout overrides the table's configured turn timeout when
	// non-zero (tests only; production uses the table configuration).
	ActionTimeout time.Duration
}

// DefaultTiming is used in production.
var DefaultTiming = Timing{StartDelay: 2 * time.Second, HandInterval: 4 * time.Second, RetryBackoff: 2 * time.Second, MaxTimeouts: 2}

// Deps are the actor's collaborators.
type Deps struct {
	Store   *store.Store
	Sealer  *sealer.Sealer
	Log     *slog.Logger
	Metrics *Metrics
	Rand    io.Reader // crypto/rand.Reader in production
	Timing  Timing
}

// Actor owns one table.
type Actor struct {
	deps  Deps
	cfg   store.TableConfig
	fence store.Fence
	log   *slog.Logger

	inbox    chan func()
	done     chan struct{}
	stopOnce sync.Once
	stopCh   chan struct{}
	mu       sync.Mutex
	stopErr  error

	// State below is only touched by the actor goroutine.
	table       *poker.Table
	handID      string
	commitment  string
	seq         int64
	turnSeq     int64
	usernames   map[string]string
	leaving     map[string]bool
	timeouts    map[string]int
	sitRequests map[string]int // successful sit request ids -> seat
	turnTimer   *time.Timer
	turnToken   int64
	deadline    time.Time
	handTimer   *time.Timer
	recent      *eventRing
	processed   *commandCache
	subs        map[int64]*Subscription
	nextSubID   int64
	draining    bool
}

// Start restores the table from durable state and starts its goroutine.
// The caller must already hold the lease identified by epoch.
func Start(ctx context.Context, deps Deps, tableID string, epoch int64) (*Actor, error) {
	cfg, err := deps.Store.LoadTable(ctx, tableID)
	if err != nil {
		return nil, err
	}
	a := &Actor{
		deps:        deps,
		cfg:         cfg,
		fence:       store.Fence{TableID: tableID, NodeID: deps.Store.NodeID, Epoch: epoch},
		log:         deps.Log.With(slog.String("table_id", tableID), slog.Int64("lease_epoch", epoch)),
		inbox:       make(chan func(), 256),
		done:        make(chan struct{}),
		stopCh:      make(chan struct{}),
		usernames:   map[string]string{},
		leaving:     map[string]bool{},
		timeouts:    map[string]int{},
		sitRequests: map[string]int{},
		recent:      newEventRing(1000),
		processed:   newCommandCache(4096),
		subs:        map[int64]*Subscription{},
	}
	if deps.Timing.ActionTimeout > 0 {
		a.cfg.ActionTimeout = deps.Timing.ActionTimeout
	}
	if err := a.recover(ctx); err != nil {
		return nil, err
	}
	deps.Metrics.ActiveTables.Inc()
	go a.run()
	a.post(a.afterChange)
	return a, nil
}

// TableID returns the table id.
func (a *Actor) TableID() string { return a.cfg.ID }

// ClubID returns the owning club id.
func (a *Actor) ClubID() string { return a.cfg.ClubID }

// Epoch returns the lease epoch this actor writes under.
func (a *Actor) Epoch() int64 { return a.fence.Epoch }

// Done is closed when the actor has stopped.
func (a *Actor) Done() <-chan struct{} { return a.done }

// Err returns why the actor stopped (nil while running or after a clean stop).
func (a *Actor) Err() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.stopErr
}

// Stop terminates the actor. Unfinished hands stay persisted as in
// progress and are resumed by the next owner.
func (a *Actor) Stop(reason error) {
	a.stopOnce.Do(func() {
		a.mu.Lock()
		a.stopErr = reason
		a.mu.Unlock()
		close(a.stopCh)
	})
}

func (a *Actor) run() {
	defer func() {
		a.stopTimers()
		for id, s := range a.subs {
			s.close()
			delete(a.subs, id)
		}
		a.deps.Metrics.ActiveTables.Dec()
		close(a.done)
	}()
	for {
		select {
		case fn := <-a.inbox:
			fn()
		case <-a.stopCh:
			return
		}
	}
}

// post enqueues work for the actor goroutine without waiting.
func (a *Actor) post(fn func()) {
	select {
	case a.inbox <- fn:
	case <-a.stopCh:
	}
}

// call runs fn on the actor goroutine and waits for it.
func call[T any](ctx context.Context, a *Actor, fn func() (T, error)) (T, error) {
	type result struct {
		v   T
		err error
	}
	ch := make(chan result, 1)
	var zero T
	select {
	case a.inbox <- func() { v, err := fn(); ch <- result{v, err} }:
	case <-a.stopCh:
		return zero, ErrStopped
	case <-ctx.Done():
		return zero, ctx.Err()
	}
	select {
	case r := <-ch:
		return r.v, r.err
	case <-a.done:
		return zero, ErrStopped
	case <-ctx.Done():
		return zero, ctx.Err()
	}
}

// commit assigns sequence numbers to drafts, persists them together with
// work (run first, in the same fenced transaction), and on success swaps in
// next as the authoritative state and publishes the events. On failure the
// in-memory state is untouched.
func (a *Actor) commit(next *poker.Table, drafts []draft, work func(ctx context.Context, tx pgx.Tx) error) ([]Event, error) {
	now := time.Now().UTC()
	events := make([]Event, len(drafts))
	persisted := make([]store.PersistedEvent, len(drafts))
	for i, d := range drafts {
		seq := a.seq + int64(i) + 1
		ev := Event{Seq: seq, HandID: d.handID, Kind: d.kind, Public: mustJSON(d.public), Time: now}
		if len(d.private) > 0 {
			ev.Private = make(map[string]json.RawMessage, len(d.private))
			for user, p := range d.private {
				ev.Private[user] = mustJSON(p)
			}
		}
		events[i] = ev
		persisted[i] = store.PersistedEvent{Seq: seq, HandID: d.handID, EventID: uuid.Must(uuid.NewV7()).String(), Type: d.kind, Payload: ev.Public}
	}
	lastSeq := a.seq + int64(len(drafts))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := a.deps.Store.InFencedTx(ctx, a.fence, func(tx pgx.Tx) error {
		if work != nil {
			if err := work(ctx, tx); err != nil {
				return err
			}
		}
		if err := store.InsertEvents(ctx, tx, a.cfg.ID, persisted); err != nil {
			return err
		}
		return store.UpsertRuntime(ctx, tx, a.cfg.ID, store.Runtime{
			LastHandNo: next.HandNo(), ButtonSeat: next.ButtonSeat(), LastSeq: lastSeq,
		})
	})
	if err != nil {
		return nil, a.persistFailure(err)
	}

	a.table = next
	a.seq = lastSeq
	for _, ev := range events {
		a.recent.push(ev)
		if ev.Kind == KindTurnStarted {
			a.turnSeq = ev.Seq
		}
	}
	a.publish(events)
	return events, nil
}

// persistFailure classifies a failed durable write. Losing the lease stops
// the actor (another node now owns the table); other failures are
// retryable and leave state unchanged.
func (a *Actor) persistFailure(err error) error {
	var te *Error
	if errors.As(err, &te) {
		return te // business rejection raised inside the transaction
	}
	if errors.Is(err, store.ErrFenced) {
		a.deps.Metrics.LeaseLosses.Inc()
		a.log.Warn("lease_lost_on_write", slog.String("error", err.Error()))
		a.Stop(err)
		return newError("TABLE_UNAVAILABLE", "table ownership moved; retry")
	}
	a.deps.Metrics.PersistFailures.WithLabelValues("write").Inc()
	a.log.Error("durable_write_failed", slog.String("error", err.Error()))
	return newError("TABLE_UNAVAILABLE", "table temporarily unavailable; retry")
}

// afterChange re-arms timers after any state change.
func (a *Actor) afterChange() {
	a.stopTimers()
	hand := a.table.Hand()
	if hand != nil && !hand.IsComplete() {
		seat, ok := hand.CurrentActor()
		if !ok {
			return
		}
		delay := time.Until(a.deadline)
		if s, ok := a.table.SeatState(seat); ok && a.leaving[string(s.Player)] {
			delay = 0 // players who are leaving act immediately
		}
		token := a.turnToken
		a.turnTimer = time.AfterFunc(max(delay, 0), func() { a.post(func() { a.onTurnTimeout(token) }) })
		return
	}
	if a.draining || a.cfg.Status != "OPEN" || !a.table.CanStartHand() {
		return
	}
	delay := a.deps.Timing.StartDelay
	if hand != nil && hand.IsComplete() {
		delay = a.deps.Timing.HandInterval
	}
	a.handTimer = time.AfterFunc(delay, func() { a.post(a.startHand) })
}

func (a *Actor) stopTimers() {
	if a.turnTimer != nil {
		a.turnTimer.Stop()
		a.turnTimer = nil
	}
	if a.handTimer != nil {
		a.handTimer.Stop()
		a.handTimer = nil
	}
}

// turnDraft builds the TURN_STARTED event for the next actor of next's hand
// (nil when no decision is pending) and sets the new deadline.
func (a *Actor) turnDraft(next *poker.Table) *draft {
	hand := next.Hand()
	if hand == nil || hand.IsComplete() {
		return nil
	}
	seat, ok := hand.CurrentActor()
	if !ok {
		return nil
	}
	s, _ := next.SeatState(seat)
	a.turnToken++
	a.deadline = time.Now().Add(a.cfg.ActionTimeout)
	base := turnStartedPayload{
		Kind: KindTurnStarted, Seat: seat, Street: string(hand.Street()), CurrentBet: hand.CurrentBet(),
		MinRaise: hand.MinRaise(), Pot: hand.Pot(), Deadline: a.deadline.UTC(), TimeoutMs: a.cfg.ActionTimeout.Milliseconds(),
	}
	private := base
	private.LegalActions = hand.LegalActions()
	return &draft{kind: KindTurnStarted, handID: a.handIDFor(next), public: base, private: map[string]any{string(s.Player): private}}
}

func (a *Actor) handIDFor(next *poker.Table) string {
	if next.Hand() == nil {
		return ""
	}
	return a.handID
}

// Drain stops starting new hands; the actor stops itself (releasing the
// table to another node) once no hand is in progress.
func (a *Actor) Drain() {
	a.post(func() {
		a.draining = true
		a.stopIfIdleDrained()
	})
}

func (a *Actor) stopIfIdleDrained() {
	if !a.draining {
		return
	}
	if h := a.table.Hand(); h == nil || h.IsComplete() {
		a.log.Info("table_drained")
		a.Stop(nil)
	}
}

// Idle reports whether the table has no players and no subscribers (the
// registry stops idle actors to free memory and leases).
func (a *Actor) Idle(ctx context.Context) bool {
	idle, err := call(ctx, a, func() (bool, error) {
		return len(a.table.Seats()) == 0 && len(a.subs) == 0, nil
	})
	return err == nil && idle
}
