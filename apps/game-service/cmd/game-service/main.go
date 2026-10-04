// Command game-service runs the authoritative table actors (poker engine,
// timers, persistence) for the tables this node owns.
//
// `game-service reseal [-batch N]` re-encrypts stored cards with the active
// key of DECK_ENCRYPTION_KEYS so retired keys can be removed (runbook:
// docs/runbooks/deck-key-rotation.md).
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bar1287/kofclub/apps/game-service/internal/api"
	"github.com/bar1287/kofclub/apps/game-service/internal/config"
	"github.com/bar1287/kofclub/apps/game-service/internal/history"
	"github.com/bar1287/kofclub/apps/game-service/internal/lease"
	"github.com/bar1287/kofclub/apps/game-service/internal/registry"
	"github.com/bar1287/kofclub/apps/game-service/internal/reseal"
	"github.com/bar1287/kofclub/apps/game-service/internal/sealer"
	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/apps/game-service/internal/table"
	"github.com/bar1287/kofclub/apps/game-service/internal/tournaments"
	"github.com/bar1287/kofclub/go/observability"
	"github.com/bar1287/kofclub/go/service"
)

const serviceName = "game-service"

func main() {
	var err error
	if len(os.Args) > 1 && os.Args[1] == "reseal" {
		err = runReseal(os.Args[2:])
	} else {
		err = run()
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", serviceName, err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}
	logger := observability.NewLogger(serviceName, cfg.Env, cfg.LogLevel).With(slog.String("node_id", cfg.NodeID))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stopTracing, err := observability.InitTracing(ctx, serviceName, cfg.Env, cfg.NodeID)
	if err != nil {
		return fmt.Errorf("tracing: %w", err)
	}
	defer func() { _ = stopTracing(context.Background()) }()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("database pool: %w", err)
	}
	defer pool.Close()
	seal, err := sealer.NewKeyring(cfg.DeckKeyring)
	if err != nil {
		return err
	}
	// Hands in progress must stay resumable: refuse to start without the
	// keys that sealed them (a key was removed before its hands finished).
	if missing, err := reseal.MissingKeys(ctx, pool, seal); err != nil {
		return fmt.Errorf("deck keys: %w", err)
	} else if len(missing) > 0 {
		return fmt.Errorf("hands in progress are sealed with deck key ids %v, which DECK_ENCRYPTION_KEYS lacks", missing)
	}
	logger.Info("deck_keys_loaded", slog.Int("active_key_id", seal.KeyID()), slog.Any("key_ids", seal.KeyIDs()))

	reg := observability.NewRegistry()
	httpMetrics := observability.NewHTTPMetrics(reg)
	deps := table.Deps{
		Store:   store.New(pool, cfg.NodeID),
		Sealer:  seal,
		Log:     logger,
		Metrics: table.NewMetrics(reg),
		Rand:    rand.Reader,
		Timing: table.Timing{
			StartDelay: cfg.StartDelay, HandInterval: cfg.HandInterval,
			RetryBackoff: table.DefaultTiming.RetryBackoff, MaxTimeouts: table.DefaultTiming.MaxTimeouts,
			TournamentPoll: cfg.TournamentPoll,
		},
	}
	var tables *registry.Registry
	deps.Wake = func(tableID string) { tables.Wake(tableID) }
	leases := lease.NewManager(pool, cfg.NodeID, cfg.AdvertiseURL, cfg.LeaseTTL)
	tables = registry.New(deps, leases, registry.Options{OrphanScanInterval: cfg.OrphanScanInterval, IdleCheckInterval: cfg.IdleCheckInterval})
	go tables.Run(ctx)
	starter := tournaments.New(deps.Store, rand.Reader, func(ctx context.Context, tableID string) error {
		_, err := tables.Get(ctx, tableID)
		return err
	}, logger, deps.Metrics, cfg.TournamentScanInterval)
	go starter.Run(ctx)

	health := observability.NewHealth(serviceName, 2*time.Second,
		observability.Check{Name: "postgres", Fn: pool.Ping},
	)
	mux := http.NewServeMux()
	health.Register(mux)
	mux.Handle("GET /metrics", observability.MetricsHandler(reg))
	api.New(tables, history.NewReader(deps.Store, seal), cfg.InternalServiceToken, logger).Register(mux)

	logger.Info("service_starting", slog.Int("port", cfg.Port), slog.String("advertise_url", cfg.AdvertiseURL))
	return service.Run(ctx, service.Options{
		Name:       serviceName,
		Addr:       fmt.Sprintf(":%d", cfg.Port),
		Handler:    observability.Middleware(logger, httpMetrics, mux),
		Health:     health,
		Logger:     logger,
		DrainDelay: cfg.DrainDelay,
		// Finish running hands and hand tables over before exiting (spec §21).
		ShutdownTimeout: cfg.DrainTimeout,
		Drain:           tables.Drain,
		OnShutdown:      func(context.Context) { cancel() },
	})
}

// runReseal re-encrypts the cards of finished hands with the active key.
func runReseal(args []string) error {
	fs := flag.NewFlagSet("reseal", flag.ContinueOnError)
	batch := fs.Int("batch", 200, "hands re-sealed per transaction")
	dryRun := fs.Bool("dry-run", false, "only report how many hands each key seals")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *batch < 1 {
		return errors.New("-batch must be at least 1")
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}
	logger := observability.NewLogger(serviceName, cfg.Env, cfg.LogLevel).With(slog.String("command", "reseal"))
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("database pool: %w", err)
	}
	defer pool.Close()
	seal, err := sealer.NewKeyring(cfg.DeckKeyring)
	if err != nil {
		return err
	}
	usage, err := reseal.KeyUsage(ctx, pool)
	if err != nil {
		return err
	}
	logger.Info("deck_key_usage", slog.Int("active_key_id", seal.KeyID()), slog.Any("hands_per_key", usage))
	if *dryRun {
		return nil
	}
	start := time.Now()
	res, err := reseal.Run(ctx, pool, seal, *batch)
	logger.Info("deck_reseal_finished", slog.Int("hands", res.Hands), slog.Int("hole_card_rows", res.Players),
		slog.Duration("took", time.Since(start)))
	if err != nil {
		return err
	}
	if usage, err = reseal.KeyUsage(ctx, pool); err != nil {
		return err
	}
	logger.Info("deck_key_usage", slog.Int("active_key_id", seal.KeyID()), slog.Any("hands_per_key", usage))
	return nil
}
