// Command migrate applies or rolls back the SQL migrations in db/migrations.
//
// Usage:
//
//	migrate up            apply all pending migrations
//	migrate down [n]      roll back n migrations (default 1)
//	migrate version       print the current schema version
//	migrate force <v>     mark version v as clean after manual repair
//
// DATABASE_URL must be set. Production deploys run `migrate up` as a
// one-shot job before rolling out new service versions.
package main

import (
	"errors"
	"fmt"
	"os"
	"strconv"

	"github.com/golang-migrate/migrate/v4"

	"github.com/bar1287/kofclub/go/dbmigrate"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL is required")
	}
	if len(args) == 0 {
		return errors.New("usage: migrate up|down [n]|version|force <v>")
	}
	m, err := dbmigrate.New(dsn)
	if err != nil {
		return err
	}
	defer func() { _, _ = m.Close() }()

	switch args[0] {
	case "up":
		err = m.Up()
	case "down":
		n := 1
		if len(args) > 1 {
			if n, err = strconv.Atoi(args[1]); err != nil || n < 1 {
				return fmt.Errorf("down: invalid step count %q", args[1])
			}
		}
		err = m.Steps(-n)
	case "version":
		v, dirty, verr := m.Version()
		if errors.Is(verr, migrate.ErrNilVersion) {
			fmt.Println("version: none")
			return nil
		}
		if verr != nil {
			return verr
		}
		fmt.Printf("version: %d dirty: %v\n", v, dirty)
		return nil
	case "force":
		if len(args) < 2 {
			return errors.New("force: version required")
		}
		v, perr := strconv.Atoi(args[1])
		if perr != nil {
			return fmt.Errorf("force: invalid version %q", args[1])
		}
		err = m.Force(v)
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
	if errors.Is(err, migrate.ErrNoChange) {
		fmt.Println("no change")
		return nil
	}
	if err != nil {
		return err
	}
	fmt.Println("ok")
	return nil
}
