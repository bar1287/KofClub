package observability

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHealthLiveAndReady(t *testing.T) {
	failing := false
	h := NewHealth("svc", time.Second, Check{Name: "db", Fn: func(context.Context) error {
		if failing {
			return errors.New("down")
		}
		return nil
	}})
	mux := http.NewServeMux()
	h.Register(mux)

	get := func(path string) (int, map[string]any) {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		var body map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return rec.Code, body
	}

	if code, _ := get("/health/live"); code != http.StatusOK {
		t.Fatalf("live = %d", code)
	}
	if code, body := get("/health/ready"); code != http.StatusOK || body["status"] != "ok" {
		t.Fatalf("ready = %d %v", code, body)
	}
	failing = true
	if code, _ := get("/health/ready"); code != http.StatusServiceUnavailable {
		t.Fatalf("ready with failing check = %d", code)
	}
	failing = false
	h.SetDraining(true)
	if code, body := get("/health/ready"); code != http.StatusServiceUnavailable || body["status"] != "draining" {
		t.Fatalf("draining ready = %d %v", code, body)
	}
	if code, _ := get("/health/live"); code != http.StatusOK {
		t.Fatal("live must stay ok while draining")
	}
}

func TestMiddlewarePropagatesRequestID(t *testing.T) {
	var buf bytes.Buffer
	logger := NewLoggerTo(&buf, "svc", "test", "debug")
	reg := NewRegistry()
	m := NewHTTPMetrics(reg)
	mux := http.NewServeMux()
	var seen string
	mux.HandleFunc("GET /x", func(w http.ResponseWriter, r *http.Request) {
		seen = RequestID(r.Context())
		w.WriteHeader(http.StatusTeapot)
	})
	h := Middleware(logger, m, mux)

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set(RequestIDHeader, "req_abc123")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if seen != "req_abc123" || rec.Header().Get(RequestIDHeader) != "req_abc123" {
		t.Fatalf("request id not propagated: seen=%q header=%q", seen, rec.Header().Get(RequestIDHeader))
	}
	if !strings.Contains(buf.String(), `"request_id":"req_abc123"`) || !strings.Contains(buf.String(), `"status":418`) {
		t.Fatalf("access log missing fields: %s", buf.String())
	}

	// Invalid ids are replaced to prevent log injection.
	req = httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set(RequestIDHeader, "bad id\nwith newline")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !strings.HasPrefix(rec.Header().Get(RequestIDHeader), "req_") || strings.Contains(seen, "\n") {
		t.Fatalf("invalid request id should be regenerated, got %q", rec.Header().Get(RequestIDHeader))
	}
}
