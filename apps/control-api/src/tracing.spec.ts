import { startTracing } from './tracing';

describe('startTracing', () => {
  it('stays disabled without an OTLP endpoint', () => {
    expect(startTracing({})).toBeNull();
  });

  it('starts an SDK when an endpoint is configured', async () => {
    const sdk = startTracing({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9' });
    expect(sdk).not.toBeNull();
    await sdk?.shutdown();
  });
});
