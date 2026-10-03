//go:build integration

package dbmigrate_test

import (
	"errors"
	"testing"

	"github.com/golang-migrate/migrate/v4"

	"github.com/bar1287/kofclub/go/dbmigrate"
	"github.com/bar1287/kofclub/go/pgtest"
)

// Every migration must apply cleanly, roll back completely and re-apply
// (spec §22: migrations are forward-safe and rollback is considered).
func TestMigrationsUpDownUp(t *testing.T) {
	url := pgtest.NewDatabase(t, false)

	m, err := dbmigrate.New(url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = m.Close() }()

	if err := m.Up(); err != nil {
		t.Fatalf("up: %v", err)
	}
	if err := m.Down(); err != nil {
		t.Fatalf("down: %v", err)
	}
	if _, _, err := m.Version(); !errors.Is(err, migrate.ErrNilVersion) {
		t.Fatalf("expected empty schema after down, got err=%v", err)
	}
	if err := m.Up(); err != nil {
		t.Fatalf("re-up: %v", err)
	}
	v, dirty, err := m.Version()
	if err != nil || dirty || v == 0 {
		t.Fatalf("version=%d dirty=%v err=%v", v, dirty, err)
	}
}
