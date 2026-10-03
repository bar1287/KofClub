package auth

import (
	"context"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// Revocations reads the session revocation cache written by control-api
// (`session:revoked:<sid>` keys and the `session:revoked` channel).
// PostgreSQL stays the source of truth; Redis only accelerates propagation.
// When Redis is unavailable the gateway fails open and relies on the short
// access-token lifetime (ADR-005, docs/security.md).
type Revocations struct {
	rdb *redis.Client
	log *slog.Logger
}

// NewRevocations wraps a Redis client.
func NewRevocations(rdb *redis.Client, log *slog.Logger) *Revocations {
	return &Revocations{rdb: rdb, log: log}
}

// IsRevoked reports whether a session was revoked.
func (r *Revocations) IsRevoked(ctx context.Context, sessionID string) bool {
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	n, err := r.rdb.Exists(ctx, "session:revoked:"+sessionID).Result()
	if err != nil {
		r.log.Warn("revocation_check_degraded", slog.String("error", err.Error()))
		return false
	}
	return n > 0
}

// Watch calls fn for every revoked session id until ctx ends, resubscribing
// after Redis outages.
func (r *Revocations) Watch(ctx context.Context, fn func(sessionID string)) {
	for ctx.Err() == nil {
		sub := r.rdb.Subscribe(ctx, "session:revoked")
		ch := sub.Channel()
	loop:
		for {
			select {
			case <-ctx.Done():
				break loop
			case msg, ok := <-ch:
				if !ok {
					break loop
				}
				fn(msg.Payload)
			}
		}
		_ = sub.Close()
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
	}
}
