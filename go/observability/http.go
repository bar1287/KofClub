package observability

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
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

// Middleware assigns/propagates a request id, continues the caller's trace
// (W3C traceparent) in a server span, attaches a request-scoped logger
// (with trace_id when traced), records metrics and writes one structured
// access-log line per request (health and metrics probes are logged at
// debug level and not traced).
func Middleware(base *slog.Logger, metrics *HTTPMetrics, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rid := r.Header.Get(RequestIDHeader)
		if !validRequestID.MatchString(rid) {
			rid = NewRequestID()
		}
		w.Header().Set(RequestIDHeader, rid)
		ctx := r.Context()
		var span trace.Span
		// Long-lived WebSocket connections are not one span; their commands
		// are traced individually.
		if !isProbe(r.URL.Path) && !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			ctx = otel.GetTextMapPropagator().Extract(ctx, propagation.HeaderCarrier(r.Header))
			ctx, span = Tracer().Start(ctx, r.Method, trace.WithSpanKind(trace.SpanKindServer),
				trace.WithAttributes(attribute.String("http.request.method", r.Method), attribute.String("request.id", rid)))
		}
		logger := base.With(slog.String("request_id", rid))
		if id := TraceID(ctx); id != "" {
			logger = logger.With(slog.String("trace_id", id))
		}
		ctx = WithLogger(WithRequestID(ctx, rid), logger)
		rec := &statusRecorder{ResponseWriter: w, code: http.StatusOK}

		req := r.WithContext(ctx)
		next.ServeHTTP(rec, req)

		// The mux records the matched pattern on the request it routed.
		route := req.Pattern
		if route == "" {
			route = r.Pattern
		}
		if route == "" {
			route = "unmatched"
		}
		if span != nil {
			span.SetName(route)
			span.SetAttributes(attribute.String("http.route", route), attribute.Int("http.response.status_code", rec.code))
			if rec.code >= 500 {
				span.SetStatus(codes.Error, http.StatusText(rec.code))
			}
			span.End()
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
