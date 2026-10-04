import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { as, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';
import { enrollMfa } from './support/mfa';

const appRoot = path.resolve(__dirname, '../..');

/** Runs the platform-admin CLI against the integration database. */
function cli(databaseUrl: string, ...args: string[]): string {
  return execFileSync(
    process.execPath,
    ['-r', '@swc-node/register', 'src/cli/platform-admin.ts', ...args],
    { cwd: appRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' },
  );
}

describe('platform administration (integration)', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let clubId: string;

  beforeAll(async () => {
    ctx = await startTestApp();
    [admin, alice, bob] = await Promise.all([
      registerUser(ctx.app, 'padmin'),
      registerUser(ctx.app, 'alice'),
      registerUser(ctx.app, 'bob'),
    ]);
    expect(cli(ctx.config.DATABASE_URL, 'grant', admin.username)).toContain('PLATFORM_ADMIN');
    expect(cli(ctx.config.DATABASE_URL, 'grant', admin.username)).toContain('already');
    // Administration needs a session verified with a second factor (ADR-017).
    const denied = await as(ctx.app, admin).get('/v1/admin/overview').expect(403);
    expect(denied.body.error).toMatchObject({ code: 'MFA_REQUIRED', details: { enrolled: false } });
    await enrollMfa(ctx.app, admin);
    const club = await as(ctx.app, alice).post('/v1/clubs').send({ name: 'Watched Club' });
    clubId = club.body.id;
    await as(ctx.app, bob).post('/v1/clubs/join').send({ code: club.body.joinCode }).expect(200);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('is reserved to platform administrators (role read from the database)', async () => {
    for (const path of ['/v1/admin/overview', '/v1/admin/users', '/v1/admin/risk-events']) {
      const res = await as(ctx.app, alice).get(path).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    // The admin's token was issued before the grant: the role still applies.
    const overview = await as(ctx.app, admin).get('/v1/admin/overview').expect(200);
    expectSchema('PlatformOverview', overview.body);
    expect(overview.body.users.platformAdmins).toBeGreaterThanOrEqual(1);
    expect(overview.body.ledger.invariantViolations).toBe(0);
  });

  it('searches accounts and clubs by prefix with pagination', async () => {
    const users = await as(ctx.app, admin)
      .get(`/v1/admin/users?q=${alice.username.slice(0, 8).toUpperCase()}`)
      .expect(200);
    expectSchema('AdminUserPage', users.body);
    expect(users.body.items.map((u: { id: string }) => u.id)).toContain(alice.id);
    const wildcard = await as(ctx.app, admin).get('/v1/admin/users?q=%25').expect(200);
    expect(wildcard.body.items).toEqual([]); // LIKE metacharacters are literal

    const first = await as(ctx.app, admin).get('/v1/admin/users?limit=1').expect(200);
    expect(first.body.items).toHaveLength(1);
    const second = await as(ctx.app, admin)
      .get(`/v1/admin/users?limit=1&cursor=${first.body.nextCursor}`)
      .expect(200);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);

    const clubs = await as(ctx.app, admin).get('/v1/admin/clubs?q=watched').expect(200);
    expectSchema('AdminClubPage', clubs.body);
    expect(clubs.body.items[0]).toMatchObject({
      id: clubId,
      ownerUsername: alice.username,
      memberCount: 2,
    });
  });

  it('suspends an account, revoking its sessions at once, and reinstates it', async () => {
    await as(ctx.app, bob).get('/v1/me').expect(200);
    const missingReason = await as(ctx.app, admin)
      .patch(`/v1/admin/users/${bob.id}`)
      .send({ status: 'SUSPENDED' })
      .expect(400);
    expect(missingReason.body.error.code).toBe('VALIDATION_FAILED');
    const res = await as(ctx.app, admin)
      .patch(`/v1/admin/users/${bob.id}`)
      .send({ status: 'SUSPENDED', reason: 'abuse report #12' })
      .expect(200);
    expectSchema('AdminUser', res.body);
    expect(res.body).toMatchObject({ status: 'SUSPENDED', activeSessions: 0 });

    const denied = await as(ctx.app, bob).get('/v1/me').expect(401);
    expect(['AUTH_SESSION_REVOKED', 'ACCOUNT_SUSPENDED']).toContain(denied.body.error.code);
    const login = await request(ctx.app.getHttpServer())
      .post('/v1/auth/login')
      .set('X-Forwarded-For', bob.ip)
      .send({ login: bob.username, password: bob.password })
      .expect(403);
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');

    await as(ctx.app, admin)
      .patch(`/v1/admin/users/${bob.id}`)
      .send({ status: 'ACTIVE', reason: 'appeal accepted' })
      .expect(200);
    await request(ctx.app.getHttpServer())
      .post('/v1/auth/login')
      .set('X-Forwarded-For', bob.ip)
      .send({ login: bob.username, password: bob.password })
      .expect(200);

    // Admins cannot lock themselves or other admins out over HTTP.
    await as(ctx.app, admin)
      .patch(`/v1/admin/users/${admin.id}`)
      .send({ status: 'SUSPENDED', reason: 'oops' })
      .expect(400);

    const audit = await as(ctx.app, admin)
      .get(`/v1/admin/audit-log?actorUserId=${admin.id}&action=USER_SUSPENDED`)
      .expect(200);
    expectSchema('AuditPage', audit.body);
    expect(audit.body.items).toHaveLength(1);
    expect(audit.body.items[0].after).toMatchObject({
      status: 'SUSPENDED',
      reason: 'abuse report #12',
    });
  });

  it('suspends a club into view-only mode', async () => {
    const res = await as(ctx.app, admin)
      .patch(`/v1/admin/clubs/${clubId}`)
      .send({ status: 'SUSPENDED', reason: 'policy review' })
      .expect(200);
    expectSchema('AdminClub', res.body);
    expect(res.body.status).toBe('SUSPENDED');
    await as(ctx.app, alice).get(`/v1/clubs/${clubId}`).expect(200); // still viewable
    const create = await as(ctx.app, alice)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({ name: 'Blocked', smallBlind: 5, bigBlind: 10, buyInMin: 200, buyInMax: 2000 })
      .expect(403);
    expect(create.body.error.code).toBe('FORBIDDEN');
    await as(ctx.app, alice)
      .post(`/v1/clubs/${clubId}/chips/grants`)
      .set('Idempotency-Key', `grant-${randomUUID()}`)
      .send({ userId: bob.id, amount: 100 })
      .expect(403);
    await as(ctx.app, admin)
      .patch(`/v1/admin/clubs/${clubId}`)
      .send({ status: 'ACTIVE', reason: 'review done' })
      .expect(200);
    await as(ctx.app, alice)
      .post(`/v1/clubs/${clubId}/tables`)
      .send({ name: 'Allowed', smallBlind: 5, bigBlind: 10, buyInMin: 200, buyInMax: 2000 })
      .expect(201);
  });

  it('reviews risk cases once, keeping the evidence immutable', async () => {
    const inserted = await ctx.db.query<{ id: string }>(
      `INSERT INTO risk_events (subject_user_id, club_id, type, severity, score, evidence_refs)
       VALUES ($1, $2, 'CHIP_DUMPING_SUSPECTED', 'HIGH', 80, '["hand:x"]') RETURNING id`,
      [bob.id, clubId],
    );
    const id = inserted.rows[0]!.id;
    const open = await as(ctx.app, admin).get('/v1/admin/risk-events?status=OPEN').expect(200);
    expectSchema('RiskEventPage', open.body);
    expect(open.body.items.map((e: { id: string }) => e.id)).toContain(id);

    const reviewed = await as(ctx.app, admin)
      .patch(`/v1/admin/risk-events/${id}`)
      .send({ disposition: 'DISMISSED', note: 'normal heads-up play' })
      .expect(200);
    expectSchema('RiskEvent', reviewed.body);
    expect(reviewed.body).toMatchObject({
      disposition: 'DISMISSED',
      reviewNote: 'normal heads-up play',
      reviewedByUsername: admin.username,
      score: 80,
      subjectUsername: bob.username,
    });
    const again = await as(ctx.app, admin)
      .patch(`/v1/admin/risk-events/${id}`)
      .send({ disposition: 'CONFIRMED', note: 'changed my mind' })
      .expect(409);
    expect(again.body.error.code).toBe('CONFLICT');
    const after = await as(ctx.app, admin).get('/v1/admin/risk-events?status=OPEN').expect(200);
    expect(after.body.items.map((e: { id: string }) => e.id)).not.toContain(id);
    await expect(
      ctx.db.query(`UPDATE risk_events SET score = 1 WHERE id = $1`, [id]),
    ).rejects.toThrow(/immutable/);
  });

  it('revoking the role via the CLI takes effect on the next request', async () => {
    expect(cli(ctx.config.DATABASE_URL, 'revoke', admin.username)).toContain('USER');
    await as(ctx.app, admin).get('/v1/admin/overview').expect(403);
    const grants = await ctx.db.query(
      `SELECT action FROM audit_log WHERE object_id = $1 AND action LIKE 'PLATFORM_ADMIN_%' ORDER BY created_at`,
      [admin.id],
    );
    expect(grants.rows.map((r) => r.action)).toEqual([
      'PLATFORM_ADMIN_GRANTED',
      'PLATFORM_ADMIN_REVOKED',
    ]);
  });
});
