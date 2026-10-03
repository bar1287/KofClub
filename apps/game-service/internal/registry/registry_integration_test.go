//go:build integration

package registry_test

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/bar1287/kofclub/apps/game-service/internal/lease"
	"github.com/bar1287/kofclub/apps/game-service/internal/registry"
	"github.com/bar1287/kofclub/apps/game-service/internal/sealer"
	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/apps/game-service/internal/table"
	"github.com/bar1287/kofclub/go/pgtest"
)

func newRegistry(t *testing.T, pool *pgxpool.Pool, node string) (*registry.Registry, *lease.Manager) {
	t.Helper()
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	seal, err := sealer.New(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	deps := table.Deps{
		Store: store.New(pool, node), Sealer: seal, Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Metrics: table.NewMetrics(prometheus.NewRegistry()), Rand: rand.Reader, Timing: table.DefaultTiming,
	}
	leases := lease.NewManager(pool, node, "http://"+node, 30*time.Second)
	return registry.New(deps, leases, registry.Options{OrphanScanInterval: time.Hour, IdleCheckInterval: time.Hour}), leases
}

func createTable(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	user, club, tbl := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, 'x')`, []any{user, user + "@example.test", "u" + user[:8]}},
		{`INSERT INTO clubs (id, owner_user_id, name, join_code) VALUES ($1, $2, 'Club', $3)`, []any{club, user, club[:8]}},
		{`INSERT INTO tables (id, club_id, name, max_seats, small_blind, big_blind, buyin_min, buyin_max, created_by)
		  VALUES ($1, $2, 'Drain Table', 6, 5, 10, 100, 2000, $3)`, []any{tbl, club, user}},
	} {
		if _, err := pool.Exec(ctx, q.sql, q.args...); err != nil {
			t.Fatal(err)
		}
	}
	return tbl
}

// A graceful drain releases every lease before returning, so another node
// adopts the table at once instead of waiting for the lease TTL (the
// process closes its database pool right after the drain).
func TestDrainReleasesLeasesBeforeReturning(t *testing.T) {
	pool, _ := pgtest.NewPool(t)
	ctx := context.Background()
	tableIDs := []string{createTable(t, pool), createTable(t, pool)}
	nodeA, leasesA := newRegistry(t, pool, "node-a")
	for _, id := range tableIDs {
		if _, err := nodeA.Get(ctx, id); err != nil {
			t.Fatal(err)
		}
		if o, ok, err := leasesA.Owner(ctx, id); err != nil || !ok || !o.Live || o.NodeID != "node-a" {
			t.Fatalf("lease before drain: %+v ok=%v err=%v", o, ok, err)
		}
	}

	drainCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	nodeA.Drain(drainCtx)

	for _, id := range tableIDs {
		o, ok, err := leasesA.Owner(ctx, id)
		if err != nil || !ok || o.Live {
			t.Fatalf("lease after drain should be expired: %+v ok=%v err=%v", o, ok, err)
		}
	}
	if _, err := nodeA.Get(ctx, tableIDs[0]); err != registry.ErrDraining {
		t.Fatalf("draining node must refuse activations, got %v", err)
	}

	nodeB, _ := newRegistry(t, pool, "node-b")
	defer nodeB.StopAll()
	if _, err := nodeB.Get(ctx, tableIDs[0]); err != nil {
		t.Fatalf("node-b should adopt the released table immediately: %v", err)
	}
}
