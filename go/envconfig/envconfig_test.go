package envconfig

import (
	"strings"
	"testing"
	"time"
)

func TestLoaderCollectsAllErrors(t *testing.T) {
	l := NewFromMap(map[string]string{"PORT": "abc", "TIMEOUT": "nope", "ENV": "prod"})
	_ = l.Required("DATABASE_URL")
	_ = l.Int("PORT", 80, 1, 65535)
	_ = l.Duration("TIMEOUT", time.Second)
	_ = l.OneOf("ENV", "local", "local", "production")
	err := l.Err()
	if err == nil {
		t.Fatal("expected errors")
	}
	for _, want := range []string{"DATABASE_URL", "PORT", "TIMEOUT", "ENV"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not mention %s", err, want)
		}
	}
}

func TestLoaderDefaultsAndValues(t *testing.T) {
	l := NewFromMap(map[string]string{"PORT": "4200", "FLAG": "true", "BLANK": "   "})
	if got := l.Int("PORT", 1, 1, 65535); got != 4200 {
		t.Fatalf("port = %d", got)
	}
	if !l.Bool("FLAG", false) {
		t.Fatal("flag should be true")
	}
	if got := l.String("BLANK", "def"); got != "def" {
		t.Fatalf("blank values fall back to default, got %q", got)
	}
	if got := l.Duration("MISSING", 3*time.Second); got != 3*time.Second {
		t.Fatalf("duration = %v", got)
	}
	if err := l.Err(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	l2 := NewFromMap(map[string]string{"PORT": "70000"})
	l2.Int("PORT", 1, 1, 65535)
	if l2.Err() == nil {
		t.Fatal("out-of-range port must fail")
	}
}
