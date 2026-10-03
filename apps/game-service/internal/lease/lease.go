// Package lease implements single-owner table leases with fencing epochs
// (ADR-002). Leases live in PostgreSQL next to the data they protect.
package lease

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrHeldElsewhere is returned when another live node owns the table.
var ErrHeldElsewhere = errors.New("lease: table owned by another node")

// ErrLost is returned when renewing a lease this node no longer holds.
var ErrLost = errors.New("lease: lost")

// Lease is an acquired ownership grant.
type Lease struct {
	TableID string
	Epoch   int64
}

// Owner describes the current lease holder.
type Owner struct {
	NodeID    string
	URL       string
	Epoch     int64
	ExpiresAt time.Time
	Live      bool
}

// Manager acquires, renews and releases leases for one node.
type Manager struct {
	pool   *pgxpool.Pool
	nodeID string
	url    string
	ttl    time.Duration
}

// NewManager creates a lease manager.
func NewManager(pool *pgxpool.Pool, nodeID, url string, ttl time.Duration) *Manager {
	return &Manager{pool: pool, nodeID: nodeID, url: url, ttl: ttl}
}

// NodeID returns this node's id.
func (m *Manager) NodeID() string { return m.nodeID }

// URL returns this node's advertised internal URL.
func (m *Manager) URL() string { return m.url }

// TTL returns the lease duration.
func (m *Manager) TTL() time.Duration { return m.ttl }

// Acquire takes ownership when the table is unowned, the lease expired, or
// this node already holds it. Every acquisition increments the epoch, which
// fences off any previous incarnation (including this node before a restart).
func (m *Manager) Acquire(ctx context.Context, tableID string) (Lease, error) {
	var epoch int64
	err := m.pool.QueryRow(ctx, `
		INSERT INTO table_leases (table_id, owner_node_id, owner_url, epoch, expires_at)
		VALUES ($1, $2, $3, 1, now() + make_interval(secs => $4))
		ON CONFLICT (table_id) DO UPDATE
		   SET owner_node_id = EXCLUDED.owner_node_id, owner_url = EXCLUDED.owner_url,
		       epoch = table_leases.epoch + 1, expires_at = EXCLUDED.expires_at, updated_at = now()
		 WHERE table_leases.expires_at < now() OR table_leases.owner_node_id = EXCLUDED.owner_node_id
		RETURNING epoch`, tableID, m.nodeID, m.url, m.ttl.Seconds()).Scan(&epoch)
	if errors.Is(err, pgx.ErrNoRows) {
		return Lease{}, ErrHeldElsewhere
	}
	if err != nil {
		return Lease{}, err
	}
	return Lease{TableID: tableID, Epoch: epoch}, nil
}

// Renew extends a held lease; ErrLost means the actor must stop.
func (m *Manager) Renew(ctx context.Context, l Lease) error {
	tag, err := m.pool.Exec(ctx, `
		UPDATE table_leases SET expires_at = now() + make_interval(secs => $4), updated_at = now()
		 WHERE table_id = $1 AND owner_node_id = $2 AND epoch = $3`, l.TableID, m.nodeID, l.Epoch, m.ttl.Seconds())
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrLost
	}
	return nil
}

// Release expires a held lease immediately so another node can take over.
func (m *Manager) Release(ctx context.Context, l Lease) error {
	_, err := m.pool.Exec(ctx, `
		UPDATE table_leases SET expires_at = now() - interval '1 second', updated_at = now()
		 WHERE table_id = $1 AND owner_node_id = $2 AND epoch = $3`, l.TableID, m.nodeID, l.Epoch)
	return err
}

// Owner returns the current holder of a table's lease.
func (m *Manager) Owner(ctx context.Context, tableID string) (Owner, bool, error) {
	var o Owner
	err := m.pool.QueryRow(ctx, `
		SELECT owner_node_id, owner_url, epoch, expires_at, expires_at > now()
		  FROM table_leases WHERE table_id = $1`, tableID).Scan(&o.NodeID, &o.URL, &o.Epoch, &o.ExpiresAt, &o.Live)
	if errors.Is(err, pgx.ErrNoRows) {
		return Owner{}, false, nil
	}
	return o, err == nil, err
}
