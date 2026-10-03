// Command game-service runs the authoritative table actors (poker engine,
// timers, persistence) for the tables this node owns.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bar1287/kofclub/apps/game-service/internal/config"
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
	logger := observability.NewLogger(serviceName, cfg.Env, cfg.LogLevel)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("database pool: %w", err)
	}
	defer pool.Close()

	reg := observability.NewRegistry()
	metrics := observability.NewHTTPMetrics(reg)
	health := observability.NewHealth(serviceName, 2*time.Second,
		observability.Check{Name: "postgres", Fn: pool.Ping},
	)

	mux := http.NewServeMux()
	health.Register(mux)
	mux.Handle("GET /metrics", observability.MetricsHandler(reg))

	logger.Info("service_starting", slog.Int("port", cfg.Port))
	return service.Run(ctx, service.Options{
		Name:       serviceName,
		Addr:       fmt.Sprintf(":%d", cfg.Port),
		Handler:    observability.Middleware(logger, metrics, mux),
		Health:     health,
		Logger:     logger,
		DrainDelay: cfg.DrainDelay,
	})
}
