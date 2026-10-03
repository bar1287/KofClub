// Package config loads and validates realtime-gateway configuration.
package config

import (
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/bar1287/kofclub/go/envconfig"
)

// Config is the validated realtime-gateway configuration.
type Config struct {
	Env                  string
	LogLevel             string
	Port                 int
	RedisURL             string
	DrainDelay           time.Duration
	JWTPublicKeyB64      string
	JWTIssuer            string
	JWTAudience          string
	ControlAPIURL        string
	GameServiceURL       string
	InternalServiceToken string
	OriginPatterns       []string
	HeartbeatInterval    time.Duration
	AccessCacheTTL       time.Duration
}

// Load reads configuration from the environment.
func Load() (Config, error) { return load(envconfig.New()) }

func load(l *envconfig.Loader) (Config, error) {
	c := Config{
		Env:                  l.OneOf("APP_ENV", "local", "local", "test", "development", "staging", "production"),
		LogLevel:             l.OneOf("LOG_LEVEL", "info", "debug", "info", "warn", "error"),
		Port:                 l.Int("REALTIME_PORT", 4100, 1, 65535),
		RedisURL:             l.Required("REDIS_URL"),
		DrainDelay:           l.Duration("DRAIN_DELAY", 2*time.Second),
		JWTPublicKeyB64:      l.Required("AUTH_JWT_PUBLIC_KEY_B64"),
		JWTIssuer:            l.String("AUTH_JWT_ISSUER", "kofclub-control-api"),
		JWTAudience:          l.String("AUTH_JWT_AUDIENCE", "kofclub"),
		ControlAPIURL:        l.String("CONTROL_API_INTERNAL_URL", "http://localhost:4000"),
		GameServiceURL:       l.String("GAME_SERVICE_URL", "http://localhost:4200"),
		InternalServiceToken: l.Required("INTERNAL_SERVICE_TOKEN"),
		HeartbeatInterval:    l.Duration("WS_HEARTBEAT_INTERVAL", 15*time.Second),
		AccessCacheTTL:       l.Duration("ACCESS_CACHE_TTL", 15*time.Second),
	}
	for _, o := range strings.Split(l.String("CORS_ORIGINS", "http://localhost:3000"), ",") {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		u, err := url.Parse(o)
		if err != nil || u.Host == "" {
			l.Fail(errors.New("CORS_ORIGINS must contain absolute origins"))
			continue
		}
		c.OriginPatterns = append(c.OriginPatterns, u.Host)
	}
	for name, v := range map[string]string{"CONTROL_API_INTERNAL_URL": c.ControlAPIURL, "GAME_SERVICE_URL": c.GameServiceURL} {
		if u, err := url.Parse(v); err != nil || u.Host == "" {
			l.Fail(errors.New(name + " must be an absolute URL"))
		}
	}
	if len(c.InternalServiceToken) > 0 && len(c.InternalServiceToken) < 32 {
		l.Fail(errors.New("INTERNAL_SERVICE_TOKEN must be at least 32 characters"))
	}
	return c, l.Err()
}
