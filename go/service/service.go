// Package service contains the process lifecycle shared by Go deployables:
// HTTP serving, signal handling and graceful draining.
package service

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/bar1287/kofclub/go/observability"
)

// Options configures Run.
type Options struct {
	Name    string
	Addr    string
	Handler http.Handler
	Health  *observability.Health
	Logger  *slog.Logger
	// DrainDelay is how long readiness reports "draining" before the HTTP
	// server stops accepting connections, giving load balancers time to
	// route traffic elsewhere.
	DrainDelay time.Duration
	// ShutdownTimeout bounds graceful shutdown of in-flight requests.
	ShutdownTimeout time.Duration
	// OnShutdown runs after the HTTP server stopped (close pools, flush state).
	OnShutdown func(ctx context.Context)
	// Listener optionally overrides Addr (used by tests).
	Listener net.Listener
}

// Run serves HTTP until SIGINT/SIGTERM or ctx cancellation, then drains.
func Run(ctx context.Context, o Options) error {
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	srv := &http.Server{
		Addr:              o.Addr,
		Handler:           o.Handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		o.Logger.Info("service_listening", slog.String("addr", o.Addr))
		var err error
		if o.Listener != nil {
			err = srv.Serve(o.Listener)
		} else {
			err = srv.ListenAndServe()
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err, ok := <-errCh:
		if ok && err != nil {
			return err
		}
		return nil
	case <-ctx.Done():
	}

	o.Logger.Info("service_draining", slog.Duration("drain_delay", o.DrainDelay))
	if o.Health != nil {
		o.Health.SetDraining(true)
	}
	time.Sleep(o.DrainDelay)

	timeout := o.ShutdownTimeout
	if timeout == 0 {
		timeout = 15 * time.Second
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	err := srv.Shutdown(shutdownCtx)
	if o.OnShutdown != nil {
		o.OnShutdown(shutdownCtx)
	}
	o.Logger.Info("service_stopped")
	return err
}
