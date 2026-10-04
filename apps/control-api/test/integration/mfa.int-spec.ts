import { execFileSync } from 'node:child_process';
import path from 'node:path';
import request from 'supertest';
import { as, randomIp, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';
import { Enrollment, enrollMfa, freshCode } from './support/mfa';

const appRoot = path.resolve(__dirname, '../..');

function cli(databaseUrl: string, ...args: string[]): string {
  return execFileSync(
    process.execPath,
    ['-r', '@swc-node/register', 'src/cli/platform-admin.ts', ...args],
    { cwd: appRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' },
  );
}

describe('two-factor authentication (integration)', () => {
  let ctx: TestContext;
  let server: ReturnType<TestContext['app']['getHttpServer']>;

  beforeAll(async () => {
    ctx = await startTestApp();
    server = ctx.app.getHttpServer();
  });
  afterAll(async () => {
    await ctx.close();
  });

  const login = (u: TestUser, mfaCode?: string) =>
    request(server)
      .post('/v1/auth/login')
      .set('X-Forwarded-For', randomIp())
      .send({ login: u.username, password: u.password, ...(mfaCode ? { mfaCode } : {}) });

  /** The user with the tokens of a new session. */
  const session = (u: TestUser, res: request.Response): TestUser => ({
    ...u,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    sessionId: res.body.sessionId,
  });

  const audit = async (userId: string) =>
    (
      await ctx.db.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE object_id = $1 AND action LIKE 'MFA_%' ORDER BY created_at, id`,
        [userId],
      )
    ).rows.map((r) => r.action);

  describe('enrollment and login', () => {
    let u: TestUser;
    let e: Enrollment;

    beforeAll(async () => {
      u = await registerUser(ctx.app, 'mfa');
    });

    it('enrolls with a code from the app and returns recovery codes once', async () => {
      const before = await as(ctx.app, u).get('/v1/me/mfa').expect(200);
      expectSchema('MfaStatus', before.body);
      expect(before.body).toEqual({
        enabled: false,
        pending: false,
        recoveryCodesLeft: 0,
        sessionVerified: false,
      });
      const start = await as(ctx.app, u).post('/v1/me/mfa/totp').expect(201);
      expectSchema('TotpEnrollment', start.body);
      expect(start.body.otpauthUri).toContain(`KofClub%3A${u.username}`);
      expect((await as(ctx.app, u).get('/v1/me/mfa').expect(200)).body.pending).toBe(true);

      const wrong = await as(ctx.app, u)
        .post('/v1/me/mfa/totp/confirm')
        .send({ code: '000000' })
        .expect(401);
      expect(wrong.body.error.code).toBe('MFA_INVALID');

      e = await enrollMfa(ctx.app, u); // restarts with a new secret, then confirms
      expect(e.recoveryCodes).toHaveLength(10);
      expect(new Set(e.recoveryCodes).size).toBe(10);
      expect(e.recoveryCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      const after = await as(ctx.app, u).get('/v1/me/mfa').expect(200);
      expect(after.body).toEqual({
        enabled: true,
        pending: false,
        recoveryCodesLeft: 10,
        sessionVerified: true,
      });
      const again = await as(ctx.app, u).post('/v1/me/mfa/totp').expect(409);
      expect(again.body.error.code).toBe('MFA_ALREADY_ENABLED');
      // The secret is stored encrypted.
      const row = await ctx.db.query<{ totp_secret_enc: Buffer }>(
        `SELECT totp_secret_enc FROM user_mfa WHERE user_id = $1`,
        [u.id],
      );
      expect(row.rows[0]!.totp_secret_enc.toString('latin1')).not.toContain(e.secret);
      expect(await audit(u.id)).toEqual(['MFA_ENABLED']);
    });

    it('asks for the code after the password and accepts each code once', async () => {
      const badPassword = await request(server)
        .post('/v1/auth/login')
        .set('X-Forwarded-For', randomIp())
        .send({ login: u.username, password: 'wrong-password!' })
        .expect(401);
      expect(badPassword.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect((await login(u).expect(403)).body.error.code).toBe('MFA_REQUIRED');
      expect((await login(u, '123456').expect(401)).body.error.code).toBe('MFA_INVALID');

      const code = await freshCode(e, ctx.db);
      const ok = await login(u, code).expect(200);
      const verified = session(u, ok);
      expect((await as(ctx.app, verified).get('/v1/me/mfa').expect(200)).body.sessionVerified).toBe(
        true,
      );
      // Replay of the same code (same time step) is refused.
      expect((await login(u, code).expect(401)).body.error.code).toBe('MFA_INVALID');

      // Refresh-token rotation keeps the session verified.
      const refreshed = await request(server)
        .post('/v1/auth/refresh')
        .set('X-Forwarded-For', verified.ip)
        .send({ refreshToken: verified.refreshToken })
        .expect(200);
      const status = await as(ctx.app, session(verified, refreshed)).get('/v1/me/mfa').expect(200);
      expect(status.body.sessionVerified).toBe(true);
    });

    it('accepts each recovery code once, in any case and spacing', async () => {
      const recovery = e.recoveryCodes[0]!;
      const res = await login(u, ` ${recovery.toLowerCase()} `).expect(200);
      expect(
        (await as(ctx.app, session(u, res)).get('/v1/me/mfa').expect(200)).body.recoveryCodesLeft,
      ).toBe(9);
      expect((await login(u, recovery).expect(401)).body.error.code).toBe('MFA_INVALID');
      expect(await audit(u.id)).toEqual(['MFA_ENABLED', 'MFA_RECOVERY_CODE_USED']);
    });

    it('turns off with a code and un-verifies every session', async () => {
      const res = await login(u, await freshCode(e, ctx.db)).expect(200);
      const s = session(u, res);
      expect(
        (await as(ctx.app, s).post('/v1/me/mfa/totp/disable').send({ code: '111111' }).expect(401))
          .body.error.code,
      ).toBe('MFA_INVALID');
      await as(ctx.app, s)
        .post('/v1/me/mfa/totp/disable')
        .send({ code: await freshCode(e, ctx.db) })
        .expect(204);
      expect((await as(ctx.app, s).get('/v1/me/mfa').expect(200)).body).toEqual({
        enabled: false,
        pending: false,
        recoveryCodesLeft: 0,
        sessionVerified: false,
      });
      // Back to password-only sign-in; an unneeded code is ignored.
      await login(u).expect(200);
      expect(
        (await as(ctx.app, s).post('/v1/me/mfa/totp/disable').send({ code: '123456' }).expect(409))
          .body.error.code,
      ).toBe('MFA_NOT_ENABLED');
      expect(await audit(u.id)).toEqual(['MFA_ENABLED', 'MFA_RECOVERY_CODE_USED', 'MFA_DISABLED']);
    });
  });

  describe('platform administrators', () => {
    let admin: TestUser;
    let owner: TestUser;
    let clubId: string;
    let tableId: string;

    beforeAll(async () => {
      [admin, owner] = await Promise.all([
        registerUser(ctx.app, 'padmin'),
        registerUser(ctx.app, 'owner'),
      ]);
      cli(ctx.config.DATABASE_URL, 'grant', admin.username);
      const club = await as(ctx.app, owner)
        .post('/v1/clubs')
        .send({ name: 'Overseen' })
        .expect(201);
      clubId = club.body.id;
      const table = await as(ctx.app, owner)
        .post(`/v1/clubs/${clubId}/tables`)
        .send({ name: 'Watched', smallBlind: 1, bigBlind: 2, buyInMin: 40, buyInMax: 400 })
        .expect(201);
      tableId = table.body.id;
    });

    const tableAccess = (u: TestUser) =>
      request(server)
        .get(`/internal/v1/tables/${tableId}/access?userId=${u.id}&sessionId=${u.sessionId}`)
        .set('Authorization', `Bearer ${ctx.config.INTERNAL_SERVICE_TOKEN}`)
        .expect(200);

    it('need a session verified with a second factor', async () => {
      const unenrolled = await as(ctx.app, admin).get('/v1/admin/overview').expect(403);
      expect(unenrolled.body.error).toMatchObject({
        code: 'MFA_REQUIRED',
        details: { enrolled: false },
      });
      // Oversight of clubs and tables (also through the realtime gateway's check).
      expect(
        (await as(ctx.app, admin).get(`/v1/clubs/${clubId}`).expect(403)).body.error.code,
      ).toBe('MFA_REQUIRED');
      expect((await tableAccess(admin)).body).toMatchObject({
        allowed: false,
        code: 'MFA_REQUIRED',
      });

      const old = admin; // a session from before the enrollment
      const res = await login(admin).expect(200);
      admin = session(admin, res);
      const e = await enrollMfa(ctx.app, admin);
      await as(ctx.app, admin).get('/v1/admin/overview').expect(200);
      await as(ctx.app, admin).get(`/v1/clubs/${clubId}`).expect(200);
      expect((await tableAccess(admin)).body).toMatchObject({ allowed: true, clubId });

      const stale = await as(ctx.app, old).get('/v1/admin/overview').expect(403);
      expect(stale.body.error).toMatchObject({ code: 'MFA_REQUIRED', details: { enrolled: true } });
      const fresh = session(admin, await login(admin, await freshCode(e, ctx.db)).expect(200));
      await as(ctx.app, fresh).get('/v1/admin/overview').expect(200);
    });

    it('can be reset by an operator, which revokes their sessions', async () => {
      expect(cli(ctx.config.DATABASE_URL, 'reset-mfa', admin.username)).toMatch(
        /reset for .*session\(s\) revoked/,
      );
      expect((await as(ctx.app, admin).get('/v1/me/mfa').expect(401)).body.error.code).toBe(
        'AUTH_SESSION_REVOKED',
      );
      const res = await login(admin).expect(200);
      expect(
        (await as(ctx.app, session(admin, res)).get('/v1/admin/overview').expect(403)).body.error
          .details,
      ).toEqual({ enrolled: false });
      expect(cli(ctx.config.DATABASE_URL, 'reset-mfa', admin.username)).toContain(
        'has no two-factor authentication',
      );
      expect(await audit(admin.id)).toEqual(['MFA_ENABLED', 'MFA_RESET']);
    });
  });
});
