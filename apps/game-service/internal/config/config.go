// Package config loads and validates game-service configuration.
package config

import (
	"time"

	"github.com/bar1287/kofclub/go/envconfig"
)

// Config is the validated game-service configuration.
type Config struct {
	Env         string
	LogLevel    string
	Port        int
	DatabaseURL string
	DrainDelay  time.Duration
}

// Load reads configuration from the environment.
func Load() (Config, error) { return load(envconfig.New()) }

func load(l *envconfig.Loader) (Config, error) {
	c := Config{
		Env:         l.OneOf("APP_ENV", "local", "local", "test", "development", "staging", "production"),
		LogLevel:    l.OneOf("LOG_LEVEL", "info", "debug", "info", "warn", "error"),
		Port:        l.Int("GAME_SERVICE_PORT", 4200, 1, 65535),
		DatabaseURL: l.Required("DATABASE_URL"),
		DrainDelay:  l.Duration("DRAIN_DELAY", 2*time.Second),
	}
	return c, l.Err()
}
