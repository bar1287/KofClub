package observability

import (
	"context"
	"net/http"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// Tracing (spec §14): W3C trace context is always propagated so a trace
// started at the edge continues through control-api, the realtime gateway
// and the game service. Spans are exported only when an OTLP endpoint is
// configured (OTEL_EXPORTER_OTLP_ENDPOINT or
// OTEL_EXPORTER_OTLP_TRACES_ENDPOINT); sampling follows the standard
// OTEL_TRACES_SAMPLER* variables. Span attributes never carry cards, tokens
// or other private data (ADR-008).

const instrumentation = "github.com/bar1287/kofclub"

// Tracer returns the shared tracer.
func Tracer() trace.Tracer { return otel.Tracer(instrumentation) }

// InitTracing installs the propagator and, when configured, an OTLP
// exporter. The returned function flushes and stops the exporter.
func InitTracing(ctx context.Context, service, env, instance string) (func(context.Context) error, error) {
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" && os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") == "" {
		return func(context.Context) error { return nil }, nil
	}
	exporter, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(
		attribute.String("service.name", service),
		attribute.String("deployment.environment.name", env),
		attribute.String("service.instance.id", instance),
	))
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter), sdktrace.WithResource(res))
	otel.SetTracerProvider(tp)
	return tp.Shutdown, nil
}

// InjectTrace writes the current trace context into outgoing headers.
func InjectTrace(ctx context.Context, h http.Header) {
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(h))
}

// TraceID returns the active trace id ("" when there is none).
func TraceID(ctx context.Context) string {
	sc := trace.SpanContextFromContext(ctx)
	if !sc.HasTraceID() {
		return ""
	}
	return sc.TraceID().String()
}
