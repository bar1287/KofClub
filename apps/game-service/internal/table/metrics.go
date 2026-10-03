package table

import "github.com/prometheus/client_golang/prometheus"

// Metrics are the game-plane Prometheus metrics (spec §14).
type Metrics struct {
	ActiveTables      prometheus.Gauge
	HandsStarted      prometheus.Counter
	HandsCompleted    prometheus.Counter
	HandsVoided       *prometheus.CounterVec
	HandsResumed      prometheus.Counter
	Actions           *prometheus.CounterVec
	Rejections        *prometheus.CounterVec
	DuplicateCommands prometheus.Counter
	CommandLatency    prometheus.Histogram
	PersistFailures   *prometheus.CounterVec
	LeaseLosses       prometheus.Counter
	Timeouts          prometheus.Counter
}

// NewMetrics registers the metrics on reg.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	m := &Metrics{
		ActiveTables:      prometheus.NewGauge(prometheus.GaugeOpts{Name: "game_active_tables", Help: "Table actors running on this node."}),
		HandsStarted:      prometheus.NewCounter(prometheus.CounterOpts{Name: "game_hands_started_total", Help: "Hands started."}),
		HandsCompleted:    prometheus.NewCounter(prometheus.CounterOpts{Name: "game_hands_completed_total", Help: "Hands completed and settled."}),
		HandsVoided:       prometheus.NewCounterVec(prometheus.CounterOpts{Name: "game_hands_voided_total", Help: "Hands voided (no chips moved)."}, []string{"reason"}),
		HandsResumed:      prometheus.NewCounter(prometheus.CounterOpts{Name: "game_hands_resumed_total", Help: "In-progress hands restored by replay after failover."}),
		Actions:           prometheus.NewCounterVec(prometheus.CounterOpts{Name: "game_actions_total", Help: "Accepted player actions."}, []string{"kind", "source"}),
		Rejections:        prometheus.NewCounterVec(prometheus.CounterOpts{Name: "game_command_rejections_total", Help: "Rejected commands by error code."}, []string{"code"}),
		DuplicateCommands: prometheus.NewCounter(prometheus.CounterOpts{Name: "game_duplicate_commands_total", Help: "Commands answered from the idempotency cache."}),
		CommandLatency: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name: "game_command_latency_seconds", Help: "Command receipt to durable commit.",
			Buckets: []float64{.001, .0025, .005, .01, .025, .05, .1, .25, .5, 1},
		}),
		PersistFailures: prometheus.NewCounterVec(prometheus.CounterOpts{Name: "game_persist_failures_total", Help: "Failed durable writes."}, []string{"reason"}),
		LeaseLosses:     prometheus.NewCounter(prometheus.CounterOpts{Name: "game_lease_losses_total", Help: "Table leases lost (actor stopped)."}),
		Timeouts:        prometheus.NewCounter(prometheus.CounterOpts{Name: "game_turn_timeouts_total", Help: "Server-applied timeout actions."}),
	}
	reg.MustRegister(m.ActiveTables, m.HandsStarted, m.HandsCompleted, m.HandsVoided, m.HandsResumed, m.Actions,
		m.Rejections, m.DuplicateCommands, m.CommandLatency, m.PersistFailures, m.LeaseLosses, m.Timeouts)
	return m
}
