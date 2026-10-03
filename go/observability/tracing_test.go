package observability

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func recordSpans(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	rec := tracetest.NewSpanRecorder()
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec)))
	if _, err := InitTracing(context.Background(), "test", "test", "i1"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { otel.SetTracerProvider(prev) })
	return rec
}

func TestMiddlewareLabelsMetricsWithTheRoutePattern(t *testing.T) {
	reg := prometheus.NewRegistry()
	metrics := NewHTTPMetrics(reg)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /tables/{id}", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	h := Middleware(slog.New(slog.NewTextHandler(io.Discard, nil)), metrics, mux)

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/tables/abc", nil))
	if got := testutil.ToFloat64(metrics.requests.WithLabelValues("GET /tables/{id}", "GET", "204")); got != 1 {
		t.Fatalf("route-labelled request count = %v, want 1", got)
	}
}

func TestMiddlewareContinuesTheCallersTrace(t *testing.T) {
	spans := recordSpans(t)
	var logs bytes.Buffer
	mux := http.NewServeMux()
	var downstream http.Header
	mux.HandleFunc("POST /internal/v1/tables/{id}/commands", func(w http.ResponseWriter, r *http.Request) {
		downstream = http.Header{}
		InjectTrace(r.Context(), downstream) // what an outgoing call would carry
		Logger(r.Context(), nil).Info("handled")
		w.WriteHeader(http.StatusOK)
	})
	h := Middleware(slog.New(slog.NewJSONHandler(&logs, nil)), nil, mux)

	const parent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	req := httptest.NewRequest(http.MethodPost, "/internal/v1/tables/t1/commands", nil)
	req.Header.Set("traceparent", parent)
	h.ServeHTTP(httptest.NewRecorder(), req)
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/health/ready", nil))

	ended := spans.Ended()
	if len(ended) != 1 {
		t.Fatalf("expected one span (probes are not traced), got %d", len(ended))
	}
	s := ended[0]
	if s.Name() != "POST /internal/v1/tables/{id}/commands" {
		t.Fatalf("span name = %q", s.Name())
	}
	if got := s.SpanContext().TraceID().String(); got != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Fatalf("trace id = %s, want the caller's", got)
	}
	if s.Parent().SpanID().String() != "00f067aa0ba902b7" {
		t.Fatalf("parent span = %s", s.Parent().SpanID())
	}
	if !strings.Contains(downstream.Get("traceparent"), "4bf92f3577b34da6a3ce929d0e0e4736") {
		t.Fatalf("outgoing calls must carry the trace: %q", downstream.Get("traceparent"))
	}
	if !strings.Contains(logs.String(), `"trace_id":"4bf92f3577b34da6a3ce929d0e0e4736"`) {
		t.Fatalf("request logs must carry the trace id: %s", logs.String())
	}
}
