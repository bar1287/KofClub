package feed

import (
	"log/slog"
	"testing"
	"time"
)

func closed(ch <-chan struct{}) bool {
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

func TestStartedClosesWhenTheStreamStartsAndReopensOnReset(t *testing.T) {
	f := New("table", nil, slog.New(slog.DiscardHandler), 8)
	first := f.Started()
	if closed(first) {
		t.Fatal("started before the stream")
	}

	f.mu.Lock()
	f.markStartedLocked(5)
	f.mu.Unlock()
	if !closed(first) || f.LastSeq() != 5 {
		t.Fatalf("not started: closed=%v lastSeq=%d", closed(first), f.LastSeq())
	}

	f.reset("FEED_RESET")
	second := f.Started()
	if closed(second) || f.LastSeq() != -1 {
		t.Fatalf("still started after a reset: closed=%v lastSeq=%d", closed(second), f.LastSeq())
	}
	// A reset before the stream restarted keeps the pending channel, so
	// waiters on it are still released by the restart.
	f.reset("FEED_RESET")
	if f.Started() != second {
		t.Fatal("pending channel replaced")
	}
	f.mu.Lock()
	f.markStartedLocked(9)
	f.mu.Unlock()
	if !closed(second) {
		t.Fatal("restart did not release waiters")
	}
}

func TestTouchRestartsTheIdleClock(t *testing.T) {
	f := New("table", nil, slog.New(slog.DiscardHandler), 8)
	f.mu.Lock()
	f.idleSince = time.Now().Add(-time.Hour)
	f.mu.Unlock()
	if f.IdleFor() < time.Hour {
		t.Fatal("setup")
	}
	f.Touch()
	if idle := f.IdleFor(); idle > time.Second {
		t.Fatalf("still idle for %v after Touch", idle)
	}
}
