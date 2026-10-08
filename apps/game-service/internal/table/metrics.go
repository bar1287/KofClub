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
	TimeBanks         prometheus.Counter
	TopUps            prometheus.Counter

	// Tournaments (ADR-016).
	TournamentsStarted     prometheus.Counter
	TournamentsCancelled   prometheus.Counter
	TournamentsFinished    prometheus.Counter
	TournamentEliminations prometheus.Counter
	TournamentMoves        prometheus.Counter
	TournamentFailures     *prometheus.CounterVec
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
		TimeBanks:       prometheus.NewCounter(prometheus.CounterOpts{Name: "game_time_banks_started_total", Help: "Turns that ran out of time and continued on the player's time bank."}),
		TopUps:          prometheus.NewCounter(prometheus.CounterOpts{Name: "game_top_ups_total", Help: "Chips added to seated players' stacks (top-ups and re-buys)."}),

		TournamentsStarted:     prometheus.NewCounter(prometheus.CounterOpts{Name: "game_tournaments_started_total", Help: "Tournaments started by this node."}),
		TournamentsCancelled:   prometheus.NewCounter(prometheus.CounterOpts{Name: "game_tournaments_cancelled_total", Help: "Scheduled tournaments cancelled for lack of players (buy-ins refunded)."}),
		TournamentsFinished:    prometheus.NewCounter(prometheus.CounterOpts{Name: "game_tournaments_finished_total", Help: "Tournaments finished and paid out by this node."}),
		TournamentEliminations: prometheus.NewCounter(prometheus.CounterOpts{Name: "game_tournament_eliminations_total", Help: "Players eliminated from tournaments."}),
		TournamentMoves:        prometheus.NewCounter(prometheus.CounterOpts{Name: "game_tournament_moves_total", Help: "Players moved between tournament tables (balancing/breaking)."}),
		TournamentFailures: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "game_tournament_failures_total", Help: "Failed tournament operations (retried on the next poll).",
		}, []string{"op"}),
	}
	reg.MustRegister(m.ActiveTables, m.HandsStarted, m.HandsCompleted, m.HandsVoided, m.HandsResumed, m.Actions,
		m.Rejections, m.DuplicateCommands, m.CommandLatency, m.PersistFailures, m.LeaseLosses, m.Timeouts, m.TimeBanks, m.TopUps,
		m.TournamentsStarted, m.TournamentsCancelled, m.TournamentsFinished, m.TournamentEliminations,
		m.TournamentMoves, m.TournamentFailures)
	return m
}
