// Package feed maintains one internal event stream per table in the
// gateway and fans events out, in order, to subscribed client connections.
// It keeps a ring of recent events so reconnecting clients can resume from
// their last seen sequence number (ADR-004).
package feed

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/gamesvc"
)

// Listener receives events. Calls happen with the feed lock held and in
// sequence order, so implementations must not block (enqueue only).
type Listener interface {
	OnEvent(ev gamesvc.StreamFrame)
	// OnReset tells the listener that continuity was lost (feed restarted
	// from scratch); it must resync from a snapshot.
	OnReset(reason string)
}

// Source opens table streams (implemented by *gamesvc.Client).
type Source interface {
	OpenStream(ctx context.Context, tableID string, after int64) (*gamesvc.Stream, error)
}

// Feed is one table's stream.
type Feed struct {
	tableID string
	src     Source
	log     *slog.Logger
	ringCap int

	mu        sync.Mutex
	ring      []gamesvc.StreamFrame
	lastSeq   int64         // -1 until the stream started
	started   chan struct{} // closed once the stream started (replaced on reset)
	listeners map[Listener]struct{}
	idleSince time.Time
	cancel    context.CancelFunc
	done      chan struct{}
}

// New creates (but does not start) a feed.
func New(tableID string, src Source, log *slog.Logger, ringCap int) *Feed {
	return &Feed{tableID: tableID, src: src, log: log.With(slog.String("table_id", tableID)), ringCap: ringCap,
		lastSeq: -1, started: make(chan struct{}), listeners: map[Listener]struct{}{}, done: make(chan struct{}), idleSince: time.Now()}
}

// Start runs the stream loop until Stop.
func (f *Feed) Start(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	f.cancel = cancel
	go f.loop(ctx)
}

// Stop terminates the feed.
func (f *Feed) Stop() {
	if f.cancel != nil {
		f.cancel()
	}
	<-f.done
}

// LastSeq returns the newest sequence number seen (-1 if none yet).
func (f *Feed) LastSeq() int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastSeq
}

// Started returns a channel that is closed once the stream is live: every
// event committed from then on reaches the listeners. A snapshot taken
// before that may miss events that the stream will never carry (it begins
// at the table's current seq), so subscribers wait for it first.
func (f *Feed) Started() <-chan struct{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.started
}

// markStartedLocked records the stream's first seq. Caller holds f.mu.
func (f *Feed) markStartedLocked(seq int64) {
	f.lastSeq = seq
	close(f.started)
}

// Attach registers l. When after >= 0 it also returns the retained events
// with seq > after; ok=false means those events are not retained (the
// caller must resync from a snapshot). Registration and backlog extraction
// are atomic with respect to delivery, so no event is lost or duplicated.
func (f *Feed) Attach(l Listener, after int64) (backlog []gamesvc.StreamFrame, ok bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.listeners[l] = struct{}{}
	if after < 0 {
		return nil, true
	}
	if f.lastSeq < 0 || after > f.lastSeq {
		return nil, false
	}
	if after == f.lastSeq {
		return nil, true
	}
	if len(f.ring) == 0 || f.ring[0].Seq > after+1 {
		return nil, false
	}
	for _, ev := range f.ring {
		if ev.Seq > after {
			backlog = append(backlog, ev)
		}
	}
	return backlog, true
}

// Detach removes l.
func (f *Feed) Detach(l Listener) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.listeners, l)
	if len(f.listeners) == 0 {
		f.idleSince = time.Now()
	}
}

// IdleFor reports how long the feed has had no listeners (0 if it has some).
func (f *Feed) IdleFor() time.Duration {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.listeners) > 0 {
		return 0
	}
	return time.Since(f.idleSince)
}

func (f *Feed) loop(ctx context.Context) {
	defer close(f.done)
	backoff := 100 * time.Millisecond
	for ctx.Err() == nil {
		after := f.LastSeq()
		stream, err := f.src.OpenStream(ctx, f.tableID, after)
		if errors.Is(err, gamesvc.ErrResync) {
			f.reset("EVENTS_NOT_RETAINED")
			continue
		}
		if err != nil {
			f.log.Debug("feed_connect_failed", slog.String("error", err.Error()))
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			backoff = min(backoff*2, 3*time.Second)
			continue
		}
		backoff = 100 * time.Millisecond
		err = f.consume(ctx, stream)
		stream.Close()
		if errors.Is(err, gamesvc.ErrResync) || errors.Is(err, errGap) {
			reason := "FEED_RESET"
			if errors.Is(err, errGap) {
				reason = "SEQUENCE_GAP"
			}
			f.reset(reason)
		}
	}
}

var errGap = errors.New("feed: sequence gap")

func (f *Feed) consume(ctx context.Context, stream *gamesvc.Stream) error {
	for {
		frame, err := stream.Next(ctx)
		if err != nil {
			return err
		}
		f.mu.Lock()
		switch frame.Type {
		case "STREAM_START":
			if f.lastSeq < 0 {
				f.markStartedLocked(frame.Seq)
			} else if frame.Seq < f.lastSeq {
				// The table restarted behind us (should not happen: seqs are durable).
				f.mu.Unlock()
				return errGap
			}
		case "EVENT":
			if f.lastSeq >= 0 && frame.Seq != f.lastSeq+1 {
				f.mu.Unlock()
				return errGap
			}
			if f.lastSeq < 0 {
				f.markStartedLocked(frame.Seq - 1) // no STREAM_START (not sent by game-service)
			}
			f.lastSeq = frame.Seq
			f.ring = append(f.ring, frame)
			if len(f.ring) > f.ringCap {
				f.ring = f.ring[len(f.ring)-f.ringCap:]
			}
			for l := range f.listeners {
				l.OnEvent(frame)
			}
		}
		f.mu.Unlock()
	}
}

// reset drops continuity: listeners must resync from snapshots.
func (f *Feed) reset(reason string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.lastSeq >= 0 {
		f.started = make(chan struct{})
	}
	f.lastSeq = -1
	f.ring = nil
	for l := range f.listeners {
		l.OnReset(reason)
	}
	f.log.Info("feed_reset", slog.String("reason", reason))
}
