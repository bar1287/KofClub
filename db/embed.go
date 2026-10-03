// Package db embeds the SQL migrations so every Go binary and test suite
// applies exactly the same, version-controlled schema.
package db

import "embed"

// Migrations contains db/migrations/*.sql (golang-migrate naming:
// NNNNNN_name.up.sql / NNNNNN_name.down.sql).
//
//go:embed migrations/*.sql
var Migrations embed.FS
