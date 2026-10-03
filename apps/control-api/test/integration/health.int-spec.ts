import request from 'supertest';
import { startTestApp, TestContext } from './support/app';

describe('health and error envelope (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('GET /health/live returns ok', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'control-api' });
    expect(res.headers['x-request-id']).toMatch(/^req_/);
  });

  it('GET /health/ready checks postgres and redis', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.checks).toEqual({ postgres: 'ok', redis: 'ok' });
  });

  it('unknown routes return the standard error envelope and echo request ids', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/v1/does-not-exist')
      .set('X-Request-Id', 'req_test_123')
      .expect(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found', requestId: 'req_test_123' },
    });
  });

  it('exposes prometheus metrics', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toContain('http_requests_total');
  });
});
