import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests by route, method and status code.',
    labelNames: ['route', 'method', 'code'] as const,
    registers: [this.registry],
  });
  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by route.',
    labelNames: ['route', 'method'] as const,
    registers: [this.registry],
  });
  /** Security-relevant counters (login failures, refresh reuse, rate limits). */
  readonly securityEvents = new Counter({
    name: 'security_events_total',
    help: 'Security events by type.',
    labelNames: ['type'] as const,
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ service: 'control-api' });
    collectDefaultMetrics({ register: this.registry });
  }
}
