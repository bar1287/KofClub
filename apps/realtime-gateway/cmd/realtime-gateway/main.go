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

	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/access"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/auth"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/config"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/gamesvc"
	"github.com/bar1287/kofclub/apps/realtime-gateway/internal/ws"
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
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	host, _ := os.Hostname()
	stopTracing, err := observability.InitTracing(ctx, serviceName, cfg.Env, host)
	if err != nil {
		return fmt.Errorf("tracing: %w", err)
	}
	defer func() { _ = stopTracing(context.Background()) }()

	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("REDIS_URL: %w", err)
	}
	rdb := redis.NewClient(redisOpts)
	defer func() { _ = rdb.Close() }()

	verifier, err := auth.NewVerifier(cfg.JWTPublicKeyB64, cfg.JWTIssuer, cfg.JWTAudience)
	if err != nil {
		return err
	}
	revocations := auth.NewRevocations(rdb, logger)
	checker := access.NewHTTPChecker(cfg.ControlAPIURL, cfg.InternalServiceToken, cfg.AccessCacheTTL)
	game := gamesvc.New(cfg.GameServiceURL, cfg.InternalServiceToken)

	reg := observability.NewRegistry()
	httpMetrics := observability.NewHTTPMetrics(reg)
	wsCfg := ws.DefaultConfig
	wsCfg.HeartbeatInterval = cfg.HeartbeatInterval
	wsCfg.OriginPatterns = cfg.OriginPatterns
	hub := ws.NewHub(ctx, wsCfg, verifier, revocations, checker, game, logger, ws.NewMetrics(reg))
	go hub.Run(ctx)
	go revocations.Watch(ctx, func(sid string) { hub.RevokeSession(sid) })

	gameHealth := &http.Client{Timeout: 2 * time.Second}
	health := observability.NewHealth(serviceName, 2*time.Second,
		// Redis is degradable (revocation cache); readiness depends on the game plane.
		observability.Check{Name: "game-service", Fn: func(ctx context.Context) error {
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, cfg.GameServiceURL+"/health/live", nil)
			res, err := gameHealth.Do(req)
			if err != nil {
				return err
			}
			_ = res.Body.Close()
			if res.StatusCode != http.StatusOK {
				return fmt.Errorf("status %d", res.StatusCode)
			}
			return nil
		}},
	)

	mux := http.NewServeMux()
	health.Register(mux)
	mux.Handle("GET /metrics", observability.MetricsHandler(reg))
	mux.Handle("GET /ws", hub)

	logger.Info("service_starting", slog.Int("port", cfg.Port))
	return service.Run(ctx, service.Options{
		Name:       serviceName,
		Addr:       fmt.Sprintf(":%d", cfg.Port),
		Handler:    observability.Middleware(logger, httpMetrics, mux),
		Health:     health,
		Logger:     logger,
		DrainDelay: cfg.DrainDelay,
		// Clients reconnect elsewhere and resume from their last seq.
		Drain:      func(context.Context) { hub.Drain() },
		OnShutdown: func(context.Context) { cancel() },
	})
}
