// Package observability contains the logging, metrics, request-correlation
// and health-check primitives shared by every Go service.
//
// Logging rule (see docs/security.md): never log hole cards before a hand is
// complete, password material, refresh tokens, full auth headers or private
// user data.
package observability

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
)

// NewLogger builds a JSON structured logger tagged with the service name
// and deployment environment.
func NewLogger(service, env, level string) *slog.Logger {
	return NewLoggerTo(os.Stdout, service, env, level)
}

// NewLoggerTo is NewLogger with an explicit writer (used by tests).
func NewLoggerTo(w io.Writer, service, env, level string) *slog.Logger {
	h := slog.NewJSONHandler(w, &slog.HandlerOptions{Level: ParseLevel(level)})
	return slog.New(h).With(slog.String("service", service), slog.String("env", env))
}

// ParseLevel converts a textual level into a slog.Level (default info).
func ParseLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

type ctxKey int

const (
	requestIDKey ctxKey = iota
	loggerKey
)

// WithRequestID stores a request/correlation id on the context.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

// RequestID returns the request id stored on ctx, if any.
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// WithLogger stores a request-scoped logger on the context.
func WithLogger(ctx context.Context, l *slog.Logger) context.Context {
	return context.WithValue(ctx, loggerKey, l)
}

// Logger returns the request-scoped logger, falling back to def.
func Logger(ctx context.Context, def *slog.Logger) *slog.Logger {
	if l, ok := ctx.Value(loggerKey).(*slog.Logger); ok && l != nil {
		return l
	}
	return def
}
