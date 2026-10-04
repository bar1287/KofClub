// Package registry tracks the table actors running on this node: it
// activates a table by acquiring its lease, renews leases, adopts orphaned
// tables after another node died (failover), stops idle actors and drains
// the node on shutdown (spec §13.1, §21).
package registry

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/bar1287/kofclub/apps/game-service/internal/lease"
	"github.com/bar1287/kofclub/apps/game-service/internal/store"
	"github.com/bar1287/kofclub/apps/game-service/internal/table"
)

// NotOwnerError means another live node owns the table.
type NotOwnerError struct {
	OwnerURL    string
	OwnerNodeID string
}

func (e *NotOwnerError) Error() string { return fmt.Sprintf("table owned by node %s", e.OwnerNodeID) }

// ErrDraining is returned while the node is shutting down.
var ErrDraining = errors.New("registry: node is draining")

// Options tune background loops.
type Options struct {
	OrphanScanInterval time.Duration
	IdleCheckInterval  time.Duration
}

type entry struct {
	actor *table.Actor
	lease lease.Lease
}

// Registry owns the actors of this node.
type Registry struct {
	deps   table.Deps
	leases *lease.Manager
	opts   Options
	log    *slog.Logger

	mu         sync.Mutex
	actors     map[string]*entry
	activating map[string]chan struct{}
	draining   bool
	// watchers counts actors whose lease has not been released yet, so a
	// drain can hand every table over before the process exits.
	watchers sync.WaitGroup
}

// New creates a registry.
func New(deps table.Deps, leases *lease.Manager, opts Options) *Registry {
	return &Registry{
		deps: deps, leases: leases, opts: opts, log: deps.Log.With(slog.String("component", "registry")),
		actors: map[string]*entry{}, activating: map[string]chan struct{}{},
	}
}

// NodeURL returns this node's advertised URL.
func (r *Registry) NodeURL() string { return r.leases.URL() }

// Get returns the local actor for a table, activating it (lease + recovery)
// when no live node owns it. When another node owns it, a *NotOwnerError
// carries the owner's URL.
func (r *Registry) Get(ctx context.Context, tableID string) (*table.Actor, error) {
	for {
		r.mu.Lock()
		if e, ok := r.actors[tableID]; ok {
			r.mu.Unlock()
			select {
			case <-e.actor.Done():
				// Stopped concurrently; the watcher removes it. Retry activation.
				time.Sleep(10 * time.Millisecond)
				continue
			default:
				return e.actor, nil
			}
		}
		if r.draining {
			r.mu.Unlock()
			return nil, ErrDraining
		}
		if wait, ok := r.activating[tableID]; ok {
			r.mu.Unlock()
			select {
			case <-wait:
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		done := make(chan struct{})
		r.activating[tableID] = done
		r.mu.Unlock()

		actor, err := r.activate(ctx, tableID)

		r.mu.Lock()
		delete(r.activating, tableID)
		close(done)
		r.mu.Unlock()
		return actor, err
	}
}

func (r *Registry) activate(ctx context.Context, tableID string) (*table.Actor, error) {
	l, err := r.leases.Acquire(ctx, tableID)
	if errors.Is(err, lease.ErrHeldElsewhere) {
		owner, ok, oerr := r.leases.Owner(ctx, tableID)
		if oerr != nil {
			return nil, oerr
		}
		if !ok {
			return nil, err
		}
		return nil, &NotOwnerError{OwnerURL: owner.URL, OwnerNodeID: owner.NodeID}
	}
	if err != nil {
		return nil, err
	}
	actor, err := table.Start(ctx, r.deps, tableID, l.Epoch)
	if err != nil {
		_ = r.leases.Release(context.Background(), l)
		return nil, err
	}
	e := &entry{actor: actor, lease: l}
	r.mu.Lock()
	r.actors[tableID] = e
	r.watchers.Add(1) // under mu: Drain waits for activations before Wait
	r.mu.Unlock()
	r.log.Info("table_activated", slog.String("table_id", tableID), slog.Int64("epoch", l.Epoch))
	go r.watch(tableID, e)
	return actor, nil
}

// watch removes a stopped actor and releases its lease unless it was lost.
func (r *Registry) watch(tableID string, e *entry) {
	defer r.watchers.Done()
	<-e.actor.Done()
	r.mu.Lock()
	if cur, ok := r.actors[tableID]; ok && cur == e {
		delete(r.actors, tableID)
	}
	r.mu.Unlock()
	err := e.actor.Err()
	if err == nil || !errors.Is(err, store.ErrFenced) && !errors.Is(err, lease.ErrLost) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if rerr := r.leases.Release(ctx, e.lease); rerr != nil {
			r.log.Warn("lease_release_failed", slog.String("table_id", tableID), slog.String("error", rerr.Error()))
		}
	}
	r.log.Info("table_deactivated", slog.String("table_id", tableID), slog.Any("reason", err))
}

// Run renews leases, adopts orphaned tables and stops idle actors until ctx ends.
func (r *Registry) Run(ctx context.Context) {
	renew := time.NewTicker(r.leases.TTL() / 3)
	orphans := time.NewTicker(r.opts.OrphanScanInterval)
	idle := time.NewTicker(r.opts.IdleCheckInterval)
	defer renew.Stop()
	defer orphans.Stop()
	defer idle.Stop()
	r.adoptOrphans(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-renew.C:
			r.renewAll(ctx)
		case <-orphans.C:
			r.adoptOrphans(ctx)
		case <-idle.C:
			r.stopIdle(ctx)
		}
	}
}

func (r *Registry) snapshotEntries() map[string]*entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[string]*entry, len(r.actors))
	for k, v := range r.actors {
		out[k] = v
	}
	return out
}

func (r *Registry) renewAll(ctx context.Context) {
	for id, e := range r.snapshotEntries() {
		err := r.leases.Renew(ctx, e.lease)
		if errors.Is(err, lease.ErrLost) {
			r.log.Warn("lease_lost", slog.String("table_id", id))
			r.deps.Metrics.LeaseLosses.Inc()
			e.actor.Stop(lease.ErrLost)
		} else if err != nil {
			// Database unreachable: keep running; writes are fenced anyway.
			r.log.Warn("lease_renew_failed", slog.String("table_id", id), slog.String("error", err.Error()))
		}
	}
}

// adoptOrphans activates tables whose owner disappeared so their timers and
// unfinished hands continue without waiting for a client request.
func (r *Registry) adoptOrphans(ctx context.Context) {
	r.mu.Lock()
	draining := r.draining
	r.mu.Unlock()
	if draining {
		return
	}
	ids, err := r.deps.Store.OrphanedTables(ctx, 50)
	if err != nil {
		r.log.Warn("orphan_scan_failed", slog.String("error", err.Error()))
		return
	}
	for _, id := range ids {
		if _, err := r.Get(ctx, id); err != nil {
			var notOwner *NotOwnerError
			if !errors.As(err, &notOwner) {
				r.log.Warn("orphan_adoption_failed", slog.String("table_id", id), slog.String("error", err.Error()))
			}
		}
	}
}

func (r *Registry) stopIdle(ctx context.Context) {
	for _, e := range r.snapshotEntries() {
		if e.actor.Idle(ctx) {
			e.actor.Stop(nil)
		}
	}
}

// Wake nudges a locally running table (tournament players were moved to
// it); remote or inactive tables pick the work up on their next poll or
// when the orphan scan adopts them.
func (r *Registry) Wake(tableID string) {
	r.mu.Lock()
	e, ok := r.actors[tableID]
	r.mu.Unlock()
	if ok {
		e.actor.Wake()
	}
}

// Tables lists the ids of locally running tables.
func (r *Registry) Tables() []string {
	var out []string
	for id := range r.snapshotEntries() {
		out = append(out, id)
	}
	return out
}

// Drain stops accepting tables and lets every actor finish its current hand
// before stopping and releasing its lease (bounded by ctx).
func (r *Registry) Drain(ctx context.Context) {
	r.mu.Lock()
	r.draining = true
	r.mu.Unlock()
	// No activation starts once draining is set; let in-flight ones finish
	// so their actors are drained too.
	for r.activationsInFlight() > 0 && ctx.Err() == nil {
		time.Sleep(10 * time.Millisecond)
	}
	entries := r.snapshotEntries()
	for _, e := range entries {
		e.actor.Drain()
	}
	for _, e := range entries {
		select {
		case <-e.actor.Done():
		case <-ctx.Done():
			e.actor.Stop(ctx.Err())
		}
	}
	// Release every lease before returning: the process closes its database
	// pool right after the drain, and released tables can be adopted by
	// another node immediately instead of after the lease TTL.
	released := make(chan struct{})
	go func() {
		r.watchers.Wait()
		close(released)
	}()
	select {
	case <-released:
	case <-time.After(6 * time.Second):
		r.log.Warn("drain_lease_release_timeout")
	}
}

func (r *Registry) activationsInFlight() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.activating)
}

// StopAll stops every actor immediately (tests / crash simulation): leases
// are released, unfinished hands stay in progress for the next owner.
func (r *Registry) StopAll() {
	for _, e := range r.snapshotEntries() {
		e.actor.Stop(nil)
		<-e.actor.Done()
	}
}
