// Package dbmigrate applies the embedded SQL migrations (db/migrations)
// using golang-migrate. It is used by the migrate command and by
// integration tests that need a fresh schema.
package dbmigrate

import (
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5" // pgx5:// driver
	"github.com/golang-migrate/migrate/v4/source/iofs"

	"github.com/bar1287/kofclub/db"
)

// New returns a migrate instance for databaseURL (postgres:// or postgresql://).
func New(databaseURL string) (*migrate.Migrate, error) {
	src, err := iofs.New(db.Migrations, "migrations")
	if err != nil {
		return nil, fmt.Errorf("load embedded migrations: %w", err)
	}
	u, err := toPgx5URL(databaseURL)
	if err != nil {
		return nil, err
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, u)
	if err != nil {
		return nil, fmt.Errorf("open migration target: %w", err)
	}
	return m, nil
}

// Up applies all pending migrations. It is a no-op when the schema is current.
func Up(databaseURL string) error {
	m, err := New(databaseURL)
	if err != nil {
		return err
	}
	defer closeQuietly(m)
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}

func closeQuietly(m *migrate.Migrate) {
	_, _ = m.Close()
}

func toPgx5URL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid DATABASE_URL: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "postgres", "postgresql", "pgx5":
		u.Scheme = "pgx5"
	default:
		return "", fmt.Errorf("DATABASE_URL must use postgres:// scheme, got %q", u.Scheme)
	}
	return u.String(), nil
}
