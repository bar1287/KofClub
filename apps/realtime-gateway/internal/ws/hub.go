// Package ws implements the client WebSocket protocol
// (docs/realtime-protocol.md): authentication, table subscriptions with
// snapshot/replay/resync, command forwarding, heartbeats and backpressure.
package ws

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/access"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/auth"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/feed"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/gamesvc"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/protocol"
)

// Config tunes connection behaviour.
type Config struct {
	HeartbeatInterval time.Duration
	HelloTimeout      time.Duration
	SendQueue         int
	CommandsPerSecond float64
	CommandBurst      int
	FeedRing          int
	FeedIdleTimeout   time.Duration
	OriginPatterns    []string
}

// DefaultConfig is used in production.
var DefaultConfig = Config{
	HeartbeatInterval: 15 * time.Second, HelloTimeout: 10 * time.Second, SendQueue: 2048,
	CommandsPerSecond: 10, CommandBurst: 20, FeedRing: 1024, FeedIdleTimeout: 30 * time.Second,
}

// Revoker checks session revocation (nil disables the check).
type Revoker interface {
	IsRevoked(ctx context.Context, sessionID string) bool
}

// Metrics are realtime-plane metrics (spec §14).
type Metrics struct {
	Connections   prometheus.Gauge
	Feeds         prometheus.Gauge
	FramesIn      *prometheus.CounterVec
	FramesOut     *prometheus.CounterVec
	Resyncs       *prometheus.CounterVec
	AuthFailures  *prometheus.CounterVec
	SlowConsumers prometheus.Counter
	CommandRTT    prometheus.Histogram
	Subscriptions prometheus.Gauge
}

// NewMetrics registers gateway metrics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	m := &Metrics{
		Connections:   prometheus.NewGauge(prometheus.GaugeOpts{Name: "ws_connections", Help: "Open WebSocket connections."}),
		Feeds:         prometheus.NewGauge(prometheus.GaugeOpts{Name: "gateway_table_feeds", Help: "Tables with an active internal event feed."}),
		FramesIn:      prometheus.NewCounterVec(prometheus.CounterOpts{Name: "ws_frames_in_total", Help: "Client frames by type."}, []string{"type"}),
		FramesOut:     prometheus.NewCounterVec(prometheus.CounterOpts{Name: "ws_frames_out_total", Help: "Server frames by type."}, []string{"type"}),
		Resyncs:       prometheus.NewCounterVec(prometheus.CounterOpts{Name: "ws_resyncs_total", Help: "Snapshot resyncs by reason."}, []string{"reason"}),
		AuthFailures:  prometheus.NewCounterVec(prometheus.CounterOpts{Name: "ws_auth_failures_total", Help: "Rejected authentications by reason."}, []string{"reason"}),
		SlowConsumers: prometheus.NewCounter(prometheus.CounterOpts{Name: "ws_slow_consumer_disconnects_total", Help: "Connections dropped for falling behind."}),
		CommandRTT: prometheus.NewHistogram(prometheus.HistogramOpts{Name: "ws_command_latency_seconds", Help: "Command receipt to COMMAND_RESULT.",
			Buckets: []float64{.001, .0025, .005, .01, .025, .05, .1, .25, .5, 1}}),
		Subscriptions: prometheus.NewGauge(prometheus.GaugeOpts{Name: "ws_table_subscriptions", Help: "Active table subscriptions."}),
	}
	reg.MustRegister(m.Connections, m.Feeds, m.FramesIn, m.FramesOut, m.Resyncs, m.AuthFailures, m.SlowConsumers, m.CommandRTT, m.Subscriptions)
	return m
}

// Hub owns all connections and table feeds of this gateway instance.
type Hub struct {
	cfg      Config
	verifier *auth.Verifier
	revoker  Revoker
	access   access.Checker
	game     *gamesvc.Client
	log      *slog.Logger
	metrics  *Metrics
	ctx      context.Context

	mu       sync.Mutex
	feeds    map[string]*feed.Feed
	conns    map[*Conn]struct{}
	draining bool
}

// NewHub creates a hub; ctx bounds all feeds.
func NewHub(ctx context.Context, cfg Config, verifier *auth.Verifier, revoker Revoker, checker access.Checker,
	game *gamesvc.Client, log *slog.Logger, metrics *Metrics) *Hub {
	return &Hub{ctx: ctx, cfg: cfg, verifier: verifier, revoker: revoker, access: checker, game: game, log: log,
		metrics: metrics, feeds: map[string]*feed.Feed{}, conns: map[*Conn]struct{}{}}
}

// ServeHTTP upgrades a client connection.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	draining := h.draining
	h.mu.Unlock()
	if draining {
		http.Error(w, "draining", http.StatusServiceUnavailable)
		return
	}
	wsConn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.cfg.OriginPatterns})
	if err != nil {
		return
	}
	wsConn.SetReadLimit(64 << 10)
	c := newConn(h, wsConn, uuid.NewString())
	h.mu.Lock()
	h.conns[c] = struct{}{}
	h.mu.Unlock()
	h.metrics.Connections.Inc()
	defer func() {
		h.mu.Lock()
		delete(h.conns, c)
		h.mu.Unlock()
		h.metrics.Connections.Dec()
	}()
	c.run(r.Context())
}

// feedFor returns the table's feed, starting it if needed.
func (h *Hub) feedFor(tableID string) *feed.Feed {
	h.mu.Lock()
	defer h.mu.Unlock()
	if f, ok := h.feeds[tableID]; ok {
		return f
	}
	f := feed.New(tableID, h.game, h.log, h.cfg.FeedRing)
	f.Start(h.ctx)
	h.feeds[tableID] = f
	h.metrics.Feeds.Inc()
	return f
}

// Run stops feeds that have had no listeners for FeedIdleTimeout.
func (h *Hub) Run(ctx context.Context) {
	t := time.NewTicker(h.cfg.FeedIdleTimeout / 3)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			h.mu.Lock()
			var idle []*feed.Feed
			for id, f := range h.feeds {
				if f.IdleFor() > h.cfg.FeedIdleTimeout {
					idle = append(idle, f)
					delete(h.feeds, id)
					h.metrics.Feeds.Dec()
				}
			}
			h.mu.Unlock()
			for _, f := range idle {
				f.Stop()
			}
		}
	}
}

// RevokeSession closes every connection authenticated with sessionID.
func (h *Hub) RevokeSession(sessionID string) {
	for _, c := range h.connections() {
		if c.sessionID() == sessionID {
			c.fail(protocol.CloseAuthFailed, "AUTH_SESSION_REVOKED", "session revoked")
		}
	}
}

func (h *Hub) connections() []*Conn {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]*Conn, 0, len(h.conns))
	for c := range h.conns {
		out = append(out, c)
	}
	return out
}

// Drain closes all connections with "service restart" so clients
// reconnect to another instance and resume from their last seq.
func (h *Hub) Drain() {
	h.mu.Lock()
	h.draining = true
	h.mu.Unlock()
	for _, c := range h.connections() {
		c.closeWith(protocol.CloseServerDrain, "server restarting")
	}
}

// ConnectionCount returns the number of open connections.
func (h *Hub) ConnectionCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.conns)
}
