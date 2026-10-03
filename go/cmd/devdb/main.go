// Command devdb recreates the database named in DATABASE_URL (drop if it
// exists, then create it empty). It exists for local end-to-end test runs
// (scripts/e2e.sh) and refuses to run unless APP_ENV is "local" or "test".
//
// Usage:
//
//	APP_ENV=test DATABASE_URL=postgres://.../kofclub_e2e devdb recreate
package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var safeName = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "devdb: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 || args[0] != "recreate" {
		return errors.New("usage: devdb recreate")
	}
	if env := os.Getenv("APP_ENV"); env != "local" && env != "test" {
		return fmt.Errorf("refusing to run with APP_ENV=%q (only local/test)", env)
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL is required")
	}
	u, err := url.Parse(dsn)
	if err != nil {
		return fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	name := strings.TrimPrefix(u.Path, "/")
	if !safeName.MatchString(name) {
		return fmt.Errorf("unsupported database name %q", name)
	}
	admin := *u
	admin.Path = "/postgres"
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, admin.String())
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer func() { _ = conn.Close(context.Background()) }()
	if _, err := conn.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
		return fmt.Errorf("drop: %w", err)
	}
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		return fmt.Errorf("create: %w", err)
	}
	fmt.Printf("recreated database %s\n", name)
	return nil
}
