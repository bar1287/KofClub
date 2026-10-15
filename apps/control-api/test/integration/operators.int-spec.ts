import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { signInitData } from '../../src/modules/telegram/init-data';
import { as, randomIp, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';
import { enrollMfa } from './support/mfa';

// Test fixtures, not real bots.
const PLATFORM_TOKEN = '123456789:' + 'P'.repeat(35);
const ALPHA_TOKEN = '7000001:' + 'A'.repeat(35);
const ALPHA_TOKEN_2 = '7000001:' + 'a'.repeat(35);
const BETA_TOKEN = '7000002:' + 'B'.repeat(35);
const GAMMA_TOKEN = '7000003:' + 'G'.repeat(35);
const BOTS: Record<string, { id: number; is_bot: boolean; username: string }> = {
  [PLATFORM_TOKEN]: { id: 123456789, is_bot: true, username: 'kofclub_ops_bot' },
  [ALPHA_TOKEN]: { id: 7000001, is_bot: true, username: 'alpha_poker_bot' },
  [ALPHA_TOKEN_2]: { id: 7000001, is_bot: true, username: 'alpha_poker_bot' },
  [BETA_TOKEN]: { id: 7000002, is_bot: true, username: 'beta_poker_bot' },
  [GAMMA_TOKEN]: { id: 7000003, is_bot: true, username: 'gamma_poker_bot' },
};

interface BotCall {
  token: string;
  method: string;
  body: Record<string, unknown>;
}

/** A stand-in for the Bot API that knows a few bots by token. */
async function fakeTelegram() {
  const calls: BotCall[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
      const token = m?.[1] ?? '';
      const method = m?.[2] ?? '';
      res.setHeader('content-type', 'application/json');
      if (!BOTS[token]) {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }));
        return;
      }
      calls.push({ token, method, body: JSON.parse(raw || '{}') as Record<string, unknown> });
      const result = method === 'getMe' ? BOTS[token] : method === 'sendMessage' ? {} : true;
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const of = (token: string, method: string) =>
    calls.filter((c) => c.token === token && c.method === method).map((c) => c.body);
  return { server, url: `http://127.0.0.1:${port}`, calls, of };
}

function initData(token: string, tgUser: Record<string, unknown>) {
  const authDate = String(Math.floor(Date.now() / 1000) - 2);
  return signInitData({ auth_date: authDate, user: JSON.stringify(tgUser) }, token);
}

describe('operators (integration)', () => {
  let ctx: TestContext;
  let tg: Awaited<ReturnType<typeof fakeTelegram>>;
  let owner: TestUser;
  let admin: TestUser;
  const ip = randomIp();
  const http = () => request(ctx.app.getHttpServer());
  const tgLogin = (body: Record<string, unknown>) =>
    http().post('/v1/auth/telegram').set('X-Forwarded-For', ip).send(body);
  const register = (user: TestUser, body: Record<string, unknown>) =>
    as(ctx.app, user)
      .post('/v1/operators')
      .send({ name: 'Alpha Poker', slug: 'alpha', acceptTerms: true, ...body });

  beforeAll(async () => {
    tg = await fakeTelegram();
    ctx = await startTestApp({
      TELEGRAM_BOT_TOKEN: PLATFORM_TOKEN,
      TELEGRAM_BOT_USERNAME: 'kofclub_ops_bot',
      TELEGRAM_WEBHOOK_SECRET: 'platform-secret-' + 'p'.repeat(24),
      TELEGRAM_MINI_APP_URL: 'https://play.example.test',
      TELEGRAM_API_URL: tg.url,
      OPERATORS_ENABLED: 'true',
      OPERATOR_SECRET_KEY_B64: randomBytes(32).toString('base64'),
      TELEGRAM_WEBHOOK_BASE_URL: 'https://api.example.test',
      MAX_OPERATORS_PER_USER: '2',
    });
    [owner, admin] = await Promise.all([
      registerUser(ctx.app, 'opowner'),
      registerUser(ctx.app, 'opadmin'),
    ]);
    await ctx.db.query(`UPDATE users SET platform_role = 'PLATFORM_ADMIN' WHERE id = $1`, [
      admin.id,
    ]);
    await enrollMfa(ctx.app, admin);
  });
  afterAll(async () => {
    await ctx.close();
    tg.server.close();
  });

  it('registers a bot, which serves its own world once approved', async () => {
    const created = await register(owner, { botToken: ALPHA_TOKEN }).expect(201);
    expectSchema('Operator', created.body);
    expect(created.body).toMatchObject({
      slug: 'alpha',
      status: 'PENDING',
      botUsername: 'alpha_poker_bot',
      miniAppUrl: 'https://play.example.test/?op=alpha',
      ownerUsername: owner.username,
    });
    const operatorId: string = created.body.id;
    const stored = await ctx.db.query(
      `SELECT encode(bot_token_sealed, 'escape') AS t FROM operators WHERE id = $1`,
      [operatorId],
    );
    expect(String(stored.rows[0].t)).not.toContain('AAAAAAAAAA'); // sealed, not plain

    // Taken, reserved and invalid registrations (two users: registration is rate limited).
    const [t1, t2] = await Promise.all([
      registerUser(ctx.app, 'optest'),
      registerUser(ctx.app, 'optest'),
    ]);
    const again = await register(t1, { slug: 'alpha-2', botToken: ALPHA_TOKEN }).expect(409);
    expect(again.body.error.code).toBe('OPERATOR_BOT_TAKEN');
    expect((await register(t1, { botToken: BETA_TOKEN }).expect(409)).body.error.code).toBe(
      'OPERATOR_SLUG_TAKEN',
    );
    await register(t1, { slug: 'admin', botToken: BETA_TOKEN }).expect(409);
    const bad = await register(t2, { slug: 'nobot', botToken: '7999999:' + 'Z'.repeat(35) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('OPERATOR_BOT_INVALID');
    await register(t2, { slug: 'noterms', botToken: BETA_TOKEN, acceptTerms: false }).expect(400);
    await register(t2, { slug: 'platform', botToken: PLATFORM_TOKEN }).expect(409);

    // Not open before approval.
    await http().get('/v1/operators/alpha/public').expect(404);
    const pia = { id: 950000001, first_name: 'Pia', username: 'pia_alpha' };
    const early = await tgLogin({
      initData: initData(ALPHA_TOKEN, pia),
      operator: 'alpha',
      create: true,
    }).expect(403);
    expect(early.body.error.code).toBe('OPERATOR_UNAVAILABLE');
    await as(ctx.app, owner)
      .put(`/v1/admin/operators/${operatorId}/status`)
      .send({ status: 'ACTIVE', reason: 'ok' })
      .expect(403);

    // Approval connects the bot.
    const approved = await as(ctx.app, admin)
      .put(`/v1/admin/operators/${operatorId}/status`)
      .send({ status: 'ACTIVE', reason: 'Looks good' })
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'ACTIVE', statusReason: 'Looks good' });
    const hook = tg.of(ALPHA_TOKEN, 'setWebhook').at(-1)!;
    expect(hook).toMatchObject({
      url: `https://api.example.test/v1/telegram/operators/${operatorId}/webhook`,
      allowed_updates: ['message', 'pre_checkout_query'],
    });
    const secret = String(hook.secret_token);
    expect(tg.of(ALPHA_TOKEN, 'setChatMenuButton').at(-1)).toMatchObject({
      menu_button: { web_app: { url: 'https://play.example.test/?op=alpha' } },
    });
    const pub = await http().get('/v1/operators/alpha/public').expect(200);
    expectSchema('OperatorPublic', pub.body);
    expect(pub.body).toEqual({
      slug: 'alpha',
      name: 'Alpha Poker',
      botUsername: 'alpha_poker_bot',
    });

    // Players sign in with the operator's bot into a world of their own.
    await tgLogin({ initData: initData(PLATFORM_TOKEN, pia), operator: 'alpha' }).expect(401);
    const piaLogin = await tgLogin({
      initData: initData(ALPHA_TOKEN, pia),
      operator: 'alpha',
      create: true,
    }).expect(200);
    const piaUser = { accessToken: piaLogin.body.accessToken as string, ip };
    const piaOnPlatform = await tgLogin({
      initData: initData(PLATFORM_TOKEN, pia),
      create: true,
    }).expect(200);
    expect(piaOnPlatform.body.user.id).not.toBe(piaLogin.body.user.id);
    const rows = await ctx.db.query(
      `SELECT operator_id FROM users WHERE id = ANY($1::uuid[]) ORDER BY operator_id NULLS FIRST`,
      [[piaLogin.body.user.id, piaOnPlatform.body.user.id]],
    );
    expect(rows.rows).toEqual([{ operator_id: null }, { operator_id: operatorId }]);

    const club = await as(ctx.app, piaUser)
      .post('/v1/clubs')
      .send({ name: 'Alpha Home Game' })
      .expect(201);
    const sam = { id: 950000002, first_name: 'Sam' };
    const samLogin = await tgLogin({
      initData: initData(ALPHA_TOKEN, sam),
      operator: 'alpha',
      create: true,
    }).expect(200);
    await as(ctx.app, { accessToken: samLogin.body.accessToken, ip })
      .post('/v1/clubs/join')
      .send({ code: club.body.joinCode })
      .expect(200);

    // Other worlds cannot see or join it, and the database refuses mixing.
    const outsider = await as(ctx.app, owner)
      .post('/v1/clubs/join')
      .send({ code: club.body.joinCode })
      .expect(404);
    expect(outsider.body.error.code).toBe('INVITE_INVALID');
    await as(ctx.app, owner).get(`/v1/clubs/${club.body.id}`).expect(404);
    await expect(
      ctx.db.query(`INSERT INTO club_members (club_id, user_id, role) VALUES ($1, $2, 'MEMBER')`, [
        club.body.id,
        owner.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    // Platform staff still oversee every world.
    await as(ctx.app, admin).get(`/v1/clubs/${club.body.id}`).expect(200);

    // KofClub's store and Telegram linking are not part of operator worlds.
    const store = await as(ctx.app, piaUser).get('/v1/store').expect(200);
    expect(store.body.enabled).toBe(false);
    await as(ctx.app, piaUser).post('/v1/store/orders').send({ product: 'TIP_SMALL' }).expect(503);
    await as(ctx.app, piaUser)
      .post('/v1/me/telegram')
      .send({ initData: initData(PLATFORM_TOKEN, pia) })
      .expect(403);
    await as(ctx.app, piaUser)
      .post('/v1/operators')
      .send({ name: 'Nested', slug: 'nested', botToken: GAMMA_TOKEN, acceptTerms: true })
      .expect(403);

    // The operator's bot answers through its own token, with its own links.
    const webhook = (body: Record<string, unknown>, key = secret) =>
      http()
        .post(`/v1/telegram/operators/${operatorId}/webhook`)
        .set('X-Telegram-Bot-Api-Secret-Token', key)
        .send({ update_id: 1, ...body });
    const start = {
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 950000001, type: 'private' },
        from: { id: 950000001, is_bot: false, first_name: 'Pia' },
        text: `/start c-${String(club.body.joinCode).toLowerCase()}`,
      },
    };
    await webhook(start, 'wrong-secret-' + 'x'.repeat(30)).expect(401);
    await webhook(start).expect(200);
    expect(tg.of(ALPHA_TOKEN, 'sendMessage').at(-1)).toMatchObject({
      chat_id: 950000001,
      text: expect.stringContaining('Alpha Poker'),
      reply_markup: {
        inline_keyboard: [
          [
            {
              web_app: {
                url: `https://play.example.test/join?code=${club.body.joinCode}&op=alpha`,
              },
            },
          ],
        ],
      },
    });
    await webhook({
      pre_checkout_query: {
        id: 'q1',
        from: { id: 950000001 },
        currency: 'XTR',
        total_amount: 1,
        invoice_payload: 'x',
      },
    }).expect(200);
    expect(tg.of(ALPHA_TOKEN, 'answerPreCheckoutQuery').at(-1)).toMatchObject({ ok: false });

    // Suspension disconnects the bot and closes the world at once.
    await as(ctx.app, admin)
      .put(`/v1/admin/operators/${operatorId}/status`)
      .send({ status: 'SUSPENDED', reason: 'Report of play for money' })
      .expect(200);
    expect(tg.of(ALPHA_TOKEN, 'deleteWebhook')).toHaveLength(1);
    const closed = await as(ctx.app, piaUser).get('/v1/me').expect(401);
    expect(closed.body.error.code).toBe('AUTH_SESSION_REVOKED');
    expect(
      (await tgLogin({ initData: initData(ALPHA_TOKEN, pia), operator: 'alpha' }).expect(403)).body
        .error.code,
    ).toBe('OPERATOR_UNAVAILABLE');
    await webhook(start).expect(404);
    await http().get('/v1/operators/alpha/public').expect(404);
    const audit = await ctx.db.query(
      `SELECT after_json->>'status' AS status FROM audit_log
        WHERE object_id = $1 AND action = 'OPERATOR_STATUS_CHANGED' ORDER BY created_at`,
      [operatorId],
    );
    expect(audit.rows.map((r) => r.status)).toEqual(['ACTIVE', 'SUSPENDED']);

    // Reinstated: a fresh webhook secret; the old one no longer works.
    await as(ctx.app, admin)
      .put(`/v1/admin/operators/${operatorId}/status`)
      .send({ status: 'ACTIVE', reason: 'Resolved' })
      .expect(200);
    await webhook(start).expect(401);
    await tgLogin({ initData: initData(ALPHA_TOKEN, pia), operator: 'alpha' }).expect(200);

    const list = await as(ctx.app, admin).get('/v1/admin/operators?status=ACTIVE').expect(200);
    expectSchema('OperatorPage', list.body);
    expect(list.body.items.map((o: { slug: string }) => o.slug)).toContain('alpha');
  });

  it('lets the owner replace the bot token and caps bots per owner', async () => {
    const [alpha] = (await as(ctx.app, owner).get('/v1/operators/mine').expect(200)).body.items;
    expectSchema('OperatorList', { items: [alpha] });
    const wrongBot = await as(ctx.app, owner)
      .put(`/v1/operators/${alpha.id}/bot`)
      .send({ botToken: BETA_TOKEN })
      .expect(400);
    expect(wrongBot.body.error.code).toBe('OPERATOR_BOT_INVALID');
    await as(ctx.app, admin)
      .put(`/v1/operators/${alpha.id}/bot`)
      .send({ botToken: ALPHA_TOKEN_2 })
      .expect(404);
    await as(ctx.app, owner)
      .put(`/v1/operators/${alpha.id}/bot`)
      .send({ botToken: ALPHA_TOKEN_2 })
      .expect(200);
    // Active: the bot is reconnected with the new token.
    expect(tg.of(ALPHA_TOKEN_2, 'setWebhook')).toHaveLength(1);
    const pia = { id: 950000001, first_name: 'Pia' };
    await tgLogin({ initData: initData(ALPHA_TOKEN_2, pia), operator: 'alpha' }).expect(200);

    await register(owner, { slug: 'beta', botToken: BETA_TOKEN }).expect(201);
    const capped = await register(owner, { slug: 'gamma', botToken: GAMMA_TOKEN }).expect(409);
    expect(capped.body.error.code).toBe('OPERATOR_LIMIT');
  });

  it('is off unless enabled', async () => {
    const plain = await startTestApp({}, { flushRedis: false });
    try {
      const user = await registerUser(plain.app, 'noops');
      const res = await as(plain.app, user)
        .post('/v1/operators')
        .send({ name: 'Off', slug: 'off-ops', botToken: BETA_TOKEN, acceptTerms: true })
        .expect(503);
      expect(res.body.error.code).toBe('OPERATORS_DISABLED');
      const config = await request(plain.app.getHttpServer()).get('/v1/telegram/config');
      expect(config.body.operatorsEnabled).toBe(false);
    } finally {
      await plain.close();
    }
  });
});
