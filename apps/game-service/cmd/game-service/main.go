// Command game-service runs the authoritative table actors (poker engine,
// timers, persistence) for the tables this node owns.
package main

import (
	"context"
	"crypto/rand"
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
	"github.com/bar1287/kofclub/apps/game-service/internal/sealer"
	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/apps/game-service/internal/table"
	"github.com/bar1287/kofclub/go/observability"
	"github.com/bar1287/kofclub/go/service"
)

const serviceName = "game-service"

func main() {
	if err := run(); err != nil {
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
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("database pool: %w", err)
	}
	defer pool.Close()
	seal, err := sealer.New(cfg.DeckEncryptionKeyB64)
	if err != nil {
		return err
	}

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
		},
	}
	leases := lease.NewManager(pool, cfg.NodeID, cfg.AdvertiseURL, cfg.LeaseTTL)
	tables := registry.New(deps, leases, registry.Options{OrphanScanInterval: cfg.OrphanScanInterval, IdleCheckInterval: cfg.IdleCheckInterval})
	go tables.Run(ctx)

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
