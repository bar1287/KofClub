package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/coder/websocket"

	"github.com/bar1287/kofclub/apps/game-service/internal/table"
	"github.com/bar1287/kofclub/go/observability"
)

// StreamFrame is one event on the internal stream. It carries the private
// per-user payloads; only the trusted gateway consumes it.
type StreamFrame struct {
	Type       string                     `json:"type"` // STREAM_START | EVENT
	Seq        int64                      `json:"seq"`
	HandID     string                     `json:"handId,omitempty"`
	Kind       string                     `json:"kind,omitempty"`
	ServerTime time.Time                  `json:"serverTime"`
	Public     json.RawMessage            `json:"public,omitempty"`
	Private    map[string]json.RawMessage `json:"private,omitempty"`
}

// Close codes on the internal stream.
const (
	StreamCloseResync  = 4409 // backlog not retained: consumer must reset
	StreamCloseDropped = 4410 // actor stopped or consumer too slow: reconnect
)

const streamPingInterval = 15 * time.Second

// stream serves GET /internal/v1/tables/{id}/stream?after=N as a WebSocket
// of ordered events. after=-1 (default) streams only new events.
func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	after := int64(-1)
	if v := r.URL.Query().Get("after"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < -1 {
			writeError(w, r, http.StatusBadRequest, "VALIDATION_FAILED", "after must be an integer >= -1", nil)
			return
		}
		after = n
	}
	a, ok := s.actor(w, r)
	if !ok {
		return
	}
	sub, backlog, seq, err := a.Subscribe(r.Context(), after, 4096)
	if errors.Is(err, table.ErrResyncRequired) {
		writeError(w, r, http.StatusConflict, "STALE_GAME_STATE", "events after the requested seq are not retained", nil)
		return
	}
	if err != nil {
		respond(w, r, http.StatusOK, nil, err)
		return
	}
	defer a.Unsubscribe(sub)

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		return
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(1024)
	log := observability.Logger(r.Context(), s.log).With(slog.String("table_id", a.TableID()))
	ctx := conn.CloseRead(r.Context()) // the stream is one-way; reading only handles control frames

	write := func(f StreamFrame) error {
		b, _ := json.Marshal(f)
		wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		return conn.Write(wctx, websocket.MessageText, b)
	}
	if err := write(StreamFrame{Type: "STREAM_START", Seq: seq, ServerTime: time.Now().UTC()}); err != nil {
		return
	}
	for _, ev := range backlog {
		if err := write(frameOf(ev)); err != nil {
			return
		}
	}
	ping := time.NewTicker(streamPingInterval)
	defer ping.Stop()
	for {
		select {
		case ev, ok := <-sub.C:
			if !ok {
				_ = conn.Close(StreamCloseDropped, "subscription ended")
				return
			}
			if err := write(frameOf(ev)); err != nil {
				log.Debug("stream_write_failed", slog.String("error", err.Error()))
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		case <-ctx.Done():
			return
		case <-a.Done():
			_ = conn.Close(StreamCloseDropped, "table moved")
			return
		}
	}
}

func frameOf(ev table.Event) StreamFrame {
	return StreamFrame{Type: "EVENT", Seq: ev.Seq, HandID: ev.HandID, Kind: ev.Kind, ServerTime: ev.Time, Public: ev.Public, Private: ev.Private}
}
