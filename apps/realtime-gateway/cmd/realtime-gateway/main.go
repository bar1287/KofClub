// Command realtime-gateway terminates client WebSocket connections,
// authenticates them and routes table subscriptions/commands to the
// game-service node that owns each table.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/config"
	"github.com/bar1287/kofclub/go/observability"
	"github.com/bar1287/kofclub/go/service"
)

const serviceName = "realtime-gateway"

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

	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("REDIS_URL: %w", err)
	}
	rdb := redis.NewClient(redisOpts)
	defer func() { _ = rdb.Close() }()

	reg := observability.NewRegistry()
	metrics := observability.NewHTTPMetrics(reg)
	health := observability.NewHealth(serviceName, 2*time.Second,
		observability.Check{Name: "redis", Fn: func(ctx context.Context) error { return rdb.Ping(ctx).Err() }},
	)

	mux := http.NewServeMux()
	health.Register(mux)
	mux.Handle("GET /metrics", observability.MetricsHandler(reg))

	logger.Info("service_starting", slog.Int("port", cfg.Port))
	return service.Run(context.Background(), service.Options{
		Name:       serviceName,
		Addr:       fmt.Sprintf(":%d", cfg.Port),
		Handler:    observability.Middleware(logger, metrics, mux),
		Health:     health,
		Logger:     logger,
		DrainDelay: cfg.DrainDelay,
	})
}
