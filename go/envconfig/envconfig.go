// Package envconfig provides small, explicit helpers for loading and
// validating configuration from environment variables. Every Go service
// validates its configuration at startup and refuses to boot when a value
// is missing or malformed.
package envconfig

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Loader accumulates validation errors so a service can report every
// configuration problem at once instead of failing on the first one.
type Loader struct {
	lookup func(string) (string, bool)
	errs   []error
}

// New returns a Loader that reads from the process environment.
func New() *Loader { return &Loader{lookup: os.LookupEnv} }

// NewFromMap returns a Loader backed by a map (useful for tests).
func NewFromMap(m map[string]string) *Loader {
	return &Loader{lookup: func(k string) (string, bool) {
		v, ok := m[k]
		return v, ok
	}}
}

func (l *Loader) get(key string) (string, bool) {
	v, ok := l.lookup(key)
	if !ok {
		return "", false
	}
	v = strings.TrimSpace(v)
	return v, v != ""
}

// Required returns the value of key or records an error when it is unset.
func (l *Loader) Required(key string) string {
	v, ok := l.get(key)
	if !ok {
		l.errs = append(l.errs, fmt.Errorf("%s is required", key))
	}
	return v
}

// String returns the value of key or def when unset.
func (l *Loader) String(key, def string) string {
	if v, ok := l.get(key); ok {
		return v
	}
	return def
}

// OneOf returns the value of key (or def) and records an error when the
// value is not one of the allowed options.
func (l *Loader) OneOf(key, def string, allowed ...string) string {
	v := l.String(key, def)
	for _, a := range allowed {
		if v == a {
			return v
		}
	}
	l.errs = append(l.errs, fmt.Errorf("%s must be one of %v, got %q", key, allowed, v))
	return v
}

// Int returns the integer value of key (or def) and validates bounds.
func (l *Loader) Int(key string, def, min, max int) int {
	raw, ok := l.get(key)
	if !ok {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		l.errs = append(l.errs, fmt.Errorf("%s must be an integer: %w", key, err))
		return def
	}
	if v < min || v > max {
		l.errs = append(l.errs, fmt.Errorf("%s must be within [%d, %d], got %d", key, min, max, v))
	}
	return v
}

// Duration parses a Go duration string (for example "5s").
func (l *Loader) Duration(key string, def time.Duration) time.Duration {
	raw, ok := l.get(key)
	if !ok {
		return def
	}
	v, err := time.ParseDuration(raw)
	if err != nil {
		l.errs = append(l.errs, fmt.Errorf("%s must be a duration: %w", key, err))
		return def
	}
	if v <= 0 {
		l.errs = append(l.errs, fmt.Errorf("%s must be positive", key))
	}
	return v
}

// Bool parses a boolean value.
func (l *Loader) Bool(key string, def bool) bool {
	raw, ok := l.get(key)
	if !ok {
		return def
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		l.errs = append(l.errs, fmt.Errorf("%s must be a boolean: %w", key, err))
		return def
	}
	return v
}

// Fail records a custom validation error.
func (l *Loader) Fail(err error) { l.errs = append(l.errs, err) }

// Err returns every recorded validation error joined together, or nil.
func (l *Loader) Err() error { return errors.Join(l.errs...) }
