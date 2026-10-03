package observability

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// RequestIDHeader is the header used to propagate correlation ids.
const RequestIDHeader = "X-Request-Id"

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

// NewRequestID returns a random request id of the form req_<hex>.
func NewRequestID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return "req_" + hex.EncodeToString(b[:])
}

// HTTPMetrics holds the standard request counters/histograms.
type HTTPMetrics struct {
	requests *prometheus.CounterVec
	duration *prometheus.HistogramVec
}

// NewHTTPMetrics registers HTTP metrics for a service on reg.
func NewHTTPMetrics(reg prometheus.Registerer) *HTTPMetrics {
	m := &HTTPMetrics{
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "HTTP requests by route pattern, method and status code.",
		}, []string{"route", "method", "code"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request latency by route pattern.",
			Buckets: prometheus.DefBuckets,
		}, []string{"route", "method"}),
	}
	reg.MustRegister(m.requests, m.duration)
	return m
}

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}

// Unwrap lets http.ResponseController reach the underlying writer
// (required for WebSocket hijacking).
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// Middleware assigns/propagates a request id, attaches a request-scoped
// logger, records metrics and writes one structured access-log line per
// request (health and metrics probes are logged at debug level).
func Middleware(base *slog.Logger, metrics *HTTPMetrics, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rid := r.Header.Get(RequestIDHeader)
		if !validRequestID.MatchString(rid) {
			rid = NewRequestID()
		}
		w.Header().Set(RequestIDHeader, rid)
		logger := base.With(slog.String("request_id", rid))
		ctx := WithLogger(WithRequestID(r.Context(), rid), logger)
		rec := &statusRecorder{ResponseWriter: w, code: http.StatusOK}

		next.ServeHTTP(rec, r.WithContext(ctx))

		route := r.Pattern
		if route == "" {
			route = "unmatched"
		}
		elapsed := time.Since(start)
		if metrics != nil {
			metrics.requests.WithLabelValues(route, r.Method, strconv.Itoa(rec.code)).Inc()
			metrics.duration.WithLabelValues(route, r.Method).Observe(elapsed.Seconds())
		}
		level := slog.LevelInfo
		if isProbe(r.URL.Path) {
			level = slog.LevelDebug
		}
		logger.Log(ctx, level, "http_request",
			slog.String("method", r.Method),
			slog.String("route", route),
			slog.Int("status", rec.code),
			slog.Int64("duration_ms", elapsed.Milliseconds()),
		)
	})
}

func isProbe(path string) bool {
	return path == "/health/live" || path == "/health/ready" || path == "/metrics"
}
