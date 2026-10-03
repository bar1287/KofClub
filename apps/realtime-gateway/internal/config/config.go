// Package config loads and validates realtime-gateway configuration.
package config

import (
	"time"

	"github.com/bar1287/kofclub/go/envconfig"
)

// Config is the validated realtime-gateway configuration.
type Config struct {
	Env        string
	LogLevel   string
	Port       int
	RedisURL   string
	DrainDelay time.Duration
}

// Load reads configuration from the environment.
func Load() (Config, error) { return load(envconfig.New()) }

func load(l *envconfig.Loader) (Config, error) {
	c := Config{
		Env:        l.OneOf("APP_ENV", "local", "local", "test", "development", "staging", "production"),
		LogLevel:   l.OneOf("LOG_LEVEL", "info", "debug", "info", "warn", "error"),
		Port:       l.Int("REALTIME_PORT", 4100, 1, 65535),
		RedisURL:   l.Required("REDIS_URL"),
		DrainDelay: l.Duration("DRAIN_DELAY", 2*time.Second),
	}
	return c, l.Err()
}
