package observability

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// Check is a named readiness probe.
type Check struct {
	Name string
	Fn   func(ctx context.Context) error
}

// Health serves /health/live and /health/ready.
//
// Liveness only reports that the process is serving HTTP. Readiness runs
// every dependency check (database, redis, ...) with a timeout and returns
// 503 when any check fails or the service is draining.
type Health struct {
	service  string
	checks   []Check
	timeout  time.Duration
	mu       sync.RWMutex
	draining bool
}

// NewHealth creates a health handler for service with the given checks.
func NewHealth(service string, timeout time.Duration, checks ...Check) *Health {
	return &Health{service: service, checks: checks, timeout: timeout}
}

// SetDraining marks the service as not ready (used during graceful shutdown).
func (h *Health) SetDraining(d bool) {
	h.mu.Lock()
	h.draining = d
	h.mu.Unlock()
}

type healthBody struct {
	Status  string            `json:"status"`
	Service string            `json:"service"`
	Checks  map[string]string `json:"checks,omitempty"`
}

// Register mounts the health endpoints on mux.
func (h *Health) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /health/live", h.live)
	mux.HandleFunc("GET /health/ready", h.ready)
}

func (h *Health) live(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthBody{Status: "ok", Service: h.service})
}

func (h *Health) ready(w http.ResponseWriter, r *http.Request) {
	h.mu.RLock()
	draining := h.draining
	h.mu.RUnlock()

	ctx, cancel := context.WithTimeout(r.Context(), h.timeout)
	defer cancel()

	results := make(map[string]string, len(h.checks))
	ok := !draining
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, c := range h.checks {
		wg.Add(1)
		go func(c Check) {
			defer wg.Done()
			status := "ok"
			if err := c.Fn(ctx); err != nil {
				status = "fail: " + err.Error()
			}
			mu.Lock()
			if status != "ok" {
				ok = false
			}
			results[c.Name] = status
			mu.Unlock()
		}(c)
	}
	wg.Wait()

	body := healthBody{Status: "ok", Service: h.service, Checks: results}
	code := http.StatusOK
	if draining {
		body.Status = "draining"
		code = http.StatusServiceUnavailable
	} else if !ok {
		body.Status = "unavailable"
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, body)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
