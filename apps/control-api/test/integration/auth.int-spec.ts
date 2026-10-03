import { importPKCS8, SignJWT } from 'jose';
import request from 'supertest';
import { as, randomIp, registerUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';

describe('identity (integration)', () => {
  let ctx: TestContext;
  let server: ReturnType<TestContext['app']['getHttpServer']>;

  beforeAll(async () => {
    ctx = await startTestApp();
    server = ctx.app.getHttpServer();
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('register', () => {
    it('creates an account, a session and returns tokens', async () => {
      const res = await request(server)
        .post('/v1/auth/register')
        .set('X-Forwarded-For', randomIp())
        .send({
          email: 'Alice.Reg@Example.test',
          username: 'alice_reg',
          password: 'a-strong-password-1',
        })
        .expect(201);
      expectSchema('AuthResult', res.body);
      expect(res.body.user).toMatchObject({
        email: 'alice.reg@example.test',
        username: 'alice_reg',
        status: 'ACTIVE',
        platformRole: 'USER',
      });
      expect(res.body.refreshToken).toMatch(/^rt_/);

      const me = await request(server)
        .get('/v1/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expectSchema('User', me.body);
      expect(me.body.id).toBe(res.body.user.id);

      const row = await ctx.db.query('SELECT password_hash FROM users WHERE id = $1', [
        res.body.user.id,
      ]);
      expect(row.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    });

    it('rejects duplicate emails and usernames case-insensitively', async () => {
      const u = await registerUser(ctx.app);
      const dupEmail = await request(server)
        .post('/v1/auth/register')
        .set('X-Forwarded-For', randomIp())
        .send({
          email: u.email.toUpperCase(),
          username: 'other_name_1',
          password: 'a-strong-password-1',
        })
        .expect(409);
      expect(dupEmail.body.error.code).toBe('EMAIL_TAKEN');
      const dupName = await request(server)
        .post('/v1/auth/register')
        .set('X-Forwarded-For', randomIp())
        .send({
          email: 'unique.addr@example.test',
          username: u.username.toUpperCase(),
          password: 'a-strong-password-1',
        })
        .expect(409);
      expect(dupName.body.error.code).toBe('USERNAME_TAKEN');
    });

    it('validates input with machine-readable details', async () => {
      const res = await request(server)
        .post('/v1/auth/register')
        .set('X-Forwarded-For', randomIp())
        .send({ email: 'not-an-email', username: 'x', password: 'short' })
        .expect(400);
      expectSchema('ErrorEnvelope', res.body);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const paths = (res.body.error.details.issues as Array<{ path: string }>)
        .map((i) => i.path)
        .sort();
      expect(paths).toEqual(['email', 'password', 'username']);
    });

    it('rejects unknown fields', async () => {
      const res = await request(server)
        .post('/v1/auth/register')
        .set('X-Forwarded-For', randomIp())
        .send({
          email: 'x1@example.test',
          username: 'unknown_field',
          password: 'a-strong-password-1',
          platformRole: 'PLATFORM_ADMIN',
        })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('login', () => {
    it('accepts email or username and rejects bad credentials uniformly', async () => {
      const u = await registerUser(ctx.app);
      const byEmail = await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', u.ip)
        .send({ login: u.email, password: u.password })
        .expect(200);
      expectSchema('AuthResult', byEmail.body);
      await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', u.ip)
        .send({ login: u.username, password: u.password })
        .expect(200);

      const wrong = await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', u.ip)
        .send({ login: u.email, password: 'wrong-password!' })
        .expect(401);
      const unknown = await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', u.ip)
        .send({ login: 'nobody@example.test', password: 'wrong-password!' })
        .expect(401);
      expect(wrong.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(unknown.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(wrong.body.error.message).toBe(unknown.body.error.message);
    });

    it('records a risk event for a login from a new device and network', async () => {
      const u = await registerUser(ctx.app);
      await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', randomIp())
        .send({ login: u.email, password: u.password, deviceId: 'brand-new-device' })
        .expect(200);
      const risk = await ctx.db.query(
        `SELECT type, severity FROM risk_events WHERE subject_user_id = $1`,
        [u.id],
      );
      expect(risk.rows).toEqual([{ type: 'NEW_DEVICE_LOGIN', severity: 'LOW' }]);
    });

    it('blocks suspended accounts, including existing tokens', async () => {
      const u = await registerUser(ctx.app);
      await ctx.db.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [u.id]);
      const login = await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', u.ip)
        .send({ login: u.email, password: u.password })
        .expect(403);
      expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');
      const me = await as(ctx.app, u).get('/v1/me').expect(403);
      expect(me.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('tokens and sessions', () => {
    it('requires a bearer token and distinguishes invalid from expired tokens', async () => {
      expect((await request(server).get('/v1/me').expect(401)).body.error.code).toBe(
        'AUTH_REQUIRED',
      );
      expect(
        (await request(server).get('/v1/me').set('Authorization', 'Bearer garbage').expect(401))
          .body.error.code,
      ).toBe('AUTH_TOKEN_INVALID');

      const u = await registerUser(ctx.app);
      const key = await importPKCS8(ctx.privateKeyPem, 'EdDSA');
      const past = Math.floor(Date.now() / 1000) - 3600;
      const expired = await new SignJWT({ sid: u.sessionId, prole: 'USER' })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt' })
        .setSubject(u.id)
        .setIssuer(ctx.config.AUTH_JWT_ISSUER)
        .setAudience(ctx.config.AUTH_JWT_AUDIENCE)
        .setIssuedAt(past - 900)
        .setExpirationTime(past)
        .sign(key);
      const res = await request(server)
        .get('/v1/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');

      // A token for the wrong audience is invalid even with a valid signature.
      const wrongAud = await new SignJWT({ sid: u.sessionId, prole: 'PLATFORM_ADMIN' })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt' })
        .setSubject(u.id)
        .setIssuer(ctx.config.AUTH_JWT_ISSUER)
        .setAudience('someone-else')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(key);
      expect(
        (await request(server).get('/v1/me').set('Authorization', `Bearer ${wrongAud}`).expect(401))
          .body.error.code,
      ).toBe('AUTH_TOKEN_INVALID');
    });

    it('rotates refresh tokens and revokes the session on reuse', async () => {
      const u = await registerUser(ctx.app);
      const first = await request(server)
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', u.ip)
        .send({ refreshToken: u.refreshToken })
        .expect(200);
      expect(first.body.refreshToken).not.toBe(u.refreshToken);
      expect(first.body.sessionId).toBe(u.sessionId);

      // Replaying the rotated token is treated as theft.
      const replay = await request(server)
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', u.ip)
        .send({ refreshToken: u.refreshToken })
        .expect(401);
      expect(replay.body.error.code).toBe('AUTH_REFRESH_REUSED');

      // The legitimate holder's newer token and access token are now dead too.
      const after = await request(server)
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', u.ip)
        .send({ refreshToken: first.body.refreshToken })
        .expect(401);
      expect(after.body.error.code).toBe('AUTH_SESSION_REVOKED');
      const me = await as(ctx.app, { accessToken: first.body.accessToken, ip: u.ip })
        .get('/v1/me')
        .expect(401);
      expect(me.body.error.code).toBe('AUTH_SESSION_REVOKED');

      const risk = await ctx.db.query(`SELECT type FROM risk_events WHERE subject_user_id = $1`, [
        u.id,
      ]);
      expect(risk.rows.map((r) => r.type)).toContain('REFRESH_TOKEN_REUSE');
    });

    it('rejects unknown refresh tokens', async () => {
      const res = await request(server)
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', randomIp())
        .send({ refreshToken: 'rt_unknownunknownunknown' })
        .expect(401);
      expect(res.body.error.code).toBe('AUTH_REFRESH_INVALID');
    });

    it('logout revokes the session', async () => {
      const u = await registerUser(ctx.app);
      await as(ctx.app, u).post('/v1/auth/logout').expect(204);
      expect((await as(ctx.app, u).get('/v1/me').expect(401)).body.error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );
      expect(
        (
          await request(server)
            .post('/v1/auth/refresh')
            .set('X-Forwarded-For', u.ip)
            .send({ refreshToken: u.refreshToken })
            .expect(401)
        ).body.error.code,
      ).toBe('AUTH_SESSION_REVOKED');
    });

    it('lists and revokes own sessions only', async () => {
      const u = await registerUser(ctx.app);
      const second = await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', u.ip)
        .send({ login: u.email, password: u.password, deviceId: 'phone' })
        .expect(200);
      const list = await as(ctx.app, u).get('/v1/me/sessions').expect(200);
      expectSchema('SessionList', list.body);
      expect(list.body.items).toHaveLength(2);
      expect(list.body.items.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

      const other = await registerUser(ctx.app);
      expect(
        (await as(ctx.app, other).delete(`/v1/me/sessions/${second.body.sessionId}`).expect(404))
          .body.error.code,
      ).toBe('NOT_FOUND');

      await as(ctx.app, u).delete(`/v1/me/sessions/${second.body.sessionId}`).expect(204);
      await as(ctx.app, { accessToken: second.body.accessToken, ip: u.ip })
        .get('/v1/me')
        .expect(401);
      await as(ctx.app, u).get('/v1/me').expect(200);
    });

    it('supports HttpOnly cookie transport for browser refresh tokens', async () => {
      const u = await registerUser(ctx.app);
      const login = await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', u.ip)
        .set('X-Auth-Transport', 'cookie')
        .send({ login: u.email, password: u.password })
        .expect(200);
      expect(login.body.refreshToken).toBeUndefined();
      const setCookie = String(login.headers['set-cookie']);
      expect(setCookie).toMatch(/kof_rt=rt_/);
      expect(setCookie).toMatch(/HttpOnly/);
      expect(setCookie).toMatch(/SameSite=Strict/);
      expect(setCookie).toMatch(/Path=\/v1\/auth/);

      const cookie = setCookie.split(';')[0]!;
      const refreshed = await request(server)
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', u.ip)
        .set('X-Auth-Transport', 'cookie')
        .set('Cookie', cookie)
        .send({})
        .expect(200);
      expect(refreshed.body.accessToken).toBeTruthy();
      expect(String(refreshed.headers['set-cookie'])).not.toContain(cookie);
    });
  });

  describe('rate limiting', () => {
    it('limits registrations per IP and reports Retry-After', async () => {
      const ip = randomIp();
      let limited: request.Response | undefined;
      for (let i = 0; i < 12; i++) {
        const res = await request(server)
          .post('/v1/auth/register')
          .set('X-Forwarded-For', ip)
          .send({
            email: `rl${i}.${Date.now()}@example.test`,
            username: `rl_${i}_${Date.now() % 100000}`,
            password: 'a-strong-password-1',
          });
        if (res.status === 429) {
          limited = res;
          break;
        }
      }
      expect(limited).toBeDefined();
      expect(limited!.body.error.code).toBe('RATE_LIMITED');
      expect(Number(limited!.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('limits login attempts per account across IPs', async () => {
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
    });
  });
});
