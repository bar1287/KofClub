import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * OpenTelemetry tracing (spec §14). Imported first by main.ts because
 * instrumentations patch modules when they are loaded. Enabled only when an
 * OTLP endpoint is configured (OTEL_EXPORTER_OTLP_ENDPOINT or
 * OTEL_EXPORTER_OTLP_TRACES_ENDPOINT); sampling follows the standard
 * OTEL_TRACES_SAMPLER* variables. Outgoing fetches to the game service carry
 * W3C trace context, so one trace spans control-api -> game service.
 *
 * Privacy (ADR-008, logging ban): no headers or request bodies are
 * recorded, SQL is recorded without parameter values and Redis commands
 * without arguments (session ids, rate-limit keys).
 */
export function startTracing(env: NodeJS.ProcessEnv = process.env): NodeSDK | null {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT && !env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) return null;
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': env.OTEL_SERVICE_NAME ?? 'control-api',
      'deployment.environment.name': env.APP_ENV ?? 'local',
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => /^\/(health|metrics)\b/.test(req.url ?? ''),
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new IORedisInstrumentation({ dbStatementSerializer: (command) => command }),
      new UndiciInstrumentation(),
      new PinoInstrumentation(),
    ],
  });
  sdk.start();
  return sdk;
}

export const tracing = startTracing();
if (tracing) console.warn('control-api: OpenTelemetry tracing enabled');
