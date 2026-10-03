package ws

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/feed"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/gamesvc"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/protocol"
)

const maxBuffered = 4096

// subscription delivers one table's events to one connection, rendered
// for that connection's user. It guarantees the client sees a gap-free,
// ordered stream: either a replay continuing from its lastSeenSeq or a
// snapshot followed by every later event.
type subscription struct {
	conn    *Conn
	tableID string
	feed    *feed.Feed

	mu        sync.Mutex
	stopped   bool
	buffering bool
	buffer    []gamesvc.StreamFrame
	lastSent  int64 // last seq delivered to the client (-1 = none yet)
	resyncing bool
}

func newSubscription(c *Conn, tableID string, f *feed.Feed) *subscription {
	return &subscription{conn: c, tableID: tableID, feed: f, lastSent: -1}
}

// begin attaches to the feed and performs the initial replay or snapshot.
func (s *subscription) begin(lastSeen *int64, requestID string) {
	if lastSeen != nil {
		s.mu.Lock()
		s.buffering = true // hold live events until the backlog is out
		s.mu.Unlock()
		backlog, ok := s.feed.Attach(s, *lastSeen)
		if ok {
			s.mu.Lock()
			s.lastSent = *lastSeen
			for _, ev := range backlog {
				s.deliver(ev)
			}
			pending := s.buffer
			s.buffer, s.buffering = nil, false
			for _, ev := range pending {
				s.onLive(ev)
			}
			seq := s.lastSent
			s.mu.Unlock()
			s.conn.enqueue(protocol.TypeSubscribed, protocol.Subscribed{Type: protocol.TypeSubscribed, RequestID: requestID,
				TableID: s.tableID, Seq: seq, Mode: "REPLAY", Replayed: len(backlog)})
			return
		}
		s.mu.Lock()
		s.startResyncLocked("EVENTS_NOT_RETAINED", requestID)
		s.mu.Unlock()
		return
	}
	s.mu.Lock()
	s.buffering = true
	s.mu.Unlock()
	s.feed.Attach(s, -1)
	s.mu.Lock()
	s.startResyncLocked("", requestID)
	s.mu.Unlock()
}

func (s *subscription) stop() {
	s.mu.Lock()
	already := s.stopped
	s.stopped = true
	s.mu.Unlock()
	if !already {
		s.feed.Detach(s)
		s.conn.hub.metrics.Subscriptions.Dec()
	}
}

// OnEvent implements feed.Listener (called with the feed lock held).
func (s *subscription) OnEvent(ev gamesvc.StreamFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped {
		return
	}
	if s.buffering {
		if len(s.buffer) >= maxBuffered {
			s.buffer = nil
			s.resyncing = false
			s.startResyncLocked("SEQUENCE_GAP", "")
			return
		}
		s.buffer = append(s.buffer, ev)
		return
	}
	s.onLive(ev)
}

// OnReset implements feed.Listener.
func (s *subscription) OnReset(reason string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.stopped {
		s.startResyncLocked(reason, "")
	}
}

// onLive delivers a live event, detecting duplicates and gaps. Caller holds s.mu.
func (s *subscription) onLive(ev gamesvc.StreamFrame) {
	switch {
	case s.lastSent >= 0 && ev.Seq <= s.lastSent:
		return // already delivered (replay overlap)
	case s.lastSent >= 0 && ev.Seq != s.lastSent+1:
		s.startResyncLocked("SEQUENCE_GAP", "")
	default:
		s.deliver(ev)
	}
}

// deliver renders the event for this connection's user. Caller holds s.mu.
func (s *subscription) deliver(ev gamesvc.StreamFrame) {
	payload := ev.Public
	if p, ok := ev.Private[s.conn.userID()]; ok {
		payload = p
	}
	s.conn.enqueue(protocol.TypeTableEvent, protocol.TableEvent{
		Type: protocol.TypeTableEvent, TableID: s.tableID, Seq: ev.Seq, HandID: ev.HandID, ServerTime: ev.ServerTime, Event: payload,
	})
	s.lastSent = ev.Seq
}

// startResyncLocked switches to buffering and fetches a fresh snapshot.
// reason == "" is the initial subscription (no RESYNC_REQUIRED frame).
// Caller holds s.mu.
func (s *subscription) startResyncLocked(reason, requestID string) {
	if s.resyncing {
		return
	}
	s.resyncing = true
	s.buffering = true
	s.buffer = nil
	if reason != "" {
		s.conn.hub.metrics.Resyncs.WithLabelValues(reason).Inc()
	}
	go s.resync(reason, requestID)
}

func (s *subscription) resync(reason, requestID string) {
	if reason != "" {
		s.conn.enqueue(protocol.TypeResyncRequired, protocol.ResyncRequired{
			Type: protocol.TypeResyncRequired, TableID: s.tableID, Reason: reason, CurrentSeq: max(s.feed.LastSeq(), 0),
		})
	}
	var snap []byte
	var snapSeq int64
	var err error
	for attempt := 0; attempt < 5; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		snap, snapSeq, err = s.conn.hub.game.Snapshot(ctx, s.tableID, s.conn.userID())
		cancel()
		if err == nil {
			break
		}
		select {
		case <-s.conn.closed:
			return
		case <-time.After(time.Duration(attempt+1) * 300 * time.Millisecond):
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped {
		return
	}
	if err != nil {
		s.conn.log.Warn("snapshot_failed", slog.String("table_id", s.tableID), slog.String("error", err.Error()))
		s.conn.sendError("TABLE_UNAVAILABLE", "table temporarily unavailable; resubscribe", requestID, s.tableID)
		s.resyncing = false
		return
	}
	s.conn.enqueue(protocol.TypeTableSnapshot, protocol.TableSnapshot{Type: protocol.TypeTableSnapshot, TableID: s.tableID, Seq: snapSeq, Snapshot: snap})
	s.lastSent = snapSeq
	pending := s.buffer
	s.buffer, s.buffering, s.resyncing = nil, false, false
	for _, ev := range pending {
		s.onLive(ev)
		if s.resyncing {
			return // a gap in the buffered events triggered another resync
		}
	}
	s.conn.enqueue(protocol.TypeSubscribed, protocol.Subscribed{Type: protocol.TypeSubscribed, RequestID: requestID,
		TableID: s.tableID, Seq: s.lastSent, Mode: "SNAPSHOT"})
}
