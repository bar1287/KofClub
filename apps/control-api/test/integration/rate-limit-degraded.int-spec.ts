import request from 'supertest';
import { as, randomIp, registerUser } from './support/api';
import { startTestApp, TestContext } from './support/app';

// Redis is a degradable dependency (ADR-005): with Redis unreachable the API
// keeps serving, most limits fail open, and credential endpoints keep
// limiting in process memory so password guessing stays bounded.
describe('rate limiting without Redis (integration)', () => {
  let ctx: TestContext;
  let server: ReturnType<TestContext['app']['getHttpServer']>;

  beforeAll(async () => {
    // Nothing listens on port 1: every Redis command fails fast.
    ctx = await startTestApp({ REDIS_URL: 'redis://127.0.0.1:1/0' }, { flushRedis: false });
    server = ctx.app.getHttpServer();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('still limits login attempts per account across IPs', async () => {
    const u = await registerUser(ctx.app);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', randomIp())
        .send({ login: u.email, password: 'wrong-password!' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);

    // Other endpoints fail open: the account's session keeps working.
    await as(ctx.app, u).get('/v1/me').expect(200);
  });

  it('still limits login attempts per IP', async () => {
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ login: `nobody${i}@example.test`, password: 'wrong-password!' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
