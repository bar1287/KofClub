// Package config loads and validates game-service configuration.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/bar1287/kofclub/go/envconfig"
)

// Config is the validated game-service configuration.
type Config struct {
	Env                  string
	LogLevel             string
	Port                 int
	DatabaseURL          string
	DrainDelay           time.Duration
	DrainTimeout         time.Duration
	NodeID               string
	AdvertiseURL         string
	InternalServiceToken string
	DeckEncryptionKeyB64 string
	LeaseTTL             time.Duration
	OrphanScanInterval   time.Duration
	IdleCheckInterval    time.Duration
	StartDelay           time.Duration
	HandInterval         time.Duration
	// TournamentScanInterval is how often due tournaments are looked for;
	// TournamentPoll how often tournament tables check arrivals/balancing.
	TournamentScanInterval time.Duration
	TournamentPoll         time.Duration
}

// Load reads configuration from the environment.
func Load() (Config, error) { return load(envconfig.New()) }

func load(l *envconfig.Loader) (Config, error) {
	port := l.Int("GAME_SERVICE_PORT", 4200, 1, 65535)
	c := Config{
		Env:                    l.OneOf("APP_ENV", "local", "local", "test", "development", "staging", "production"),
		LogLevel:               l.OneOf("LOG_LEVEL", "info", "debug", "info", "warn", "error"),
		Port:                   port,
		DatabaseURL:            l.Required("DATABASE_URL"),
		DrainDelay:             l.Duration("DRAIN_DELAY", 2*time.Second),
		DrainTimeout:           l.Duration("DRAIN_TIMEOUT", 60*time.Second),
		NodeID:                 l.Required("GAME_NODE_ID"),
		AdvertiseURL:           l.String("GAME_NODE_ADVERTISE_URL", fmt.Sprintf("http://localhost:%d", port)),
		InternalServiceToken:   l.Required("INTERNAL_SERVICE_TOKEN"),
		DeckEncryptionKeyB64:   l.Required("DECK_ENCRYPTION_KEY_B64"),
		LeaseTTL:               l.Duration("LEASE_TTL", 10*time.Second),
		OrphanScanInterval:     l.Duration("ORPHAN_SCAN_INTERVAL", 5*time.Second),
		IdleCheckInterval:      l.Duration("IDLE_CHECK_INTERVAL", time.Minute),
		StartDelay:             l.Duration("HAND_START_DELAY", 2*time.Second),
		HandInterval:           l.Duration("HAND_INTERVAL", 4*time.Second),
		TournamentScanInterval: l.Duration("TOURNAMENT_SCAN_INTERVAL", time.Second),
		TournamentPoll:         l.Duration("TOURNAMENT_POLL_INTERVAL", time.Second),
	}
	if len(c.InternalServiceToken) > 0 && len(c.InternalServiceToken) < 32 {
		l.Fail(errors.New("INTERNAL_SERVICE_TOKEN must be at least 32 characters"))
	}
	if u, err := url.Parse(c.AdvertiseURL); err != nil || u.Scheme == "" || u.Host == "" {
		l.Fail(errors.New("GAME_NODE_ADVERTISE_URL must be an absolute URL"))
	}
	if c.LeaseTTL < 3*time.Second {
		l.Fail(errors.New("LEASE_TTL must be at least 3s"))
	}
	return c, l.Err()
}
