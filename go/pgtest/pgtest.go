// Package pgtest creates isolated, fully migrated PostgreSQL databases for
// integration tests (build tag "integration"). Each call creates a uniquely
// named database that is dropped when the test finishes.
package pgtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bar1287/kofclub/go/dbmigrate"
)

// DefaultURL is used when TEST_DATABASE_URL and DATABASE_URL are unset
// (matches docker-compose defaults).
const DefaultURL = "postgres://kofclub:kofclub_local_only@localhost:5432/kofclub?sslmode=disable"

// BaseURL returns the server URL integration tests connect to.
func BaseURL() string {
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v
	}
	return DefaultURL
}

// NewDatabase creates an empty database and returns its URL. When migrate is
// true all migrations are applied.
func NewDatabase(t testing.TB, migrate bool) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	base, err := url.Parse(BaseURL())
	if err != nil {
		t.Fatalf("pgtest: parse base url: %v", err)
	}
	var b [6]byte
	_, _ = rand.Read(b[:])
	name := "kofclub_it_" + hex.EncodeToString(b[:])

	admin := *base
	admin.Path = "/postgres"
	conn, err := pgx.Connect(ctx, admin.String())
	if err != nil {
		t.Skipf("pgtest: postgres unavailable (%v); run `make deps`", err)
	}
	defer func() { _ = conn.Close(context.Background()) }()
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatalf("pgtest: create database: %v", err)
	}

	dbURL := *base
	dbURL.Path = "/" + name
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		c, err := pgx.Connect(ctx, admin.String())
		if err != nil {
			return
		}
		defer func() { _ = c.Close(context.Background()) }()
		_, _ = c.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
	})

	if migrate {
		if err := dbmigrate.Up(dbURL.String()); err != nil {
			t.Fatalf("pgtest: migrate: %v", err)
		}
	}
	return dbURL.String()
}

// NewPool returns a pgx pool to a fresh, migrated database.
func NewPool(t testing.TB) (*pgxpool.Pool, string) {
	t.Helper()
	u := NewDatabase(t, true)
	pool, err := pgxpool.New(context.Background(), u)
	if err != nil {
		t.Fatalf("pgtest: pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool, u
}
