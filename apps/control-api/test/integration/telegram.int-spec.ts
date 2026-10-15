import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { signInitData } from '../../src/modules/telegram/init-data';
import { as, randomIp, registerUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';

const TOKEN = '123456789:' + 'T'.repeat(35); // test fixture, not a real bot
const SECRET = 'webhook-secret-' + 'x'.repeat(24); // test fixture
const MINI_APP = 'https://poker.example.test';

interface ApiCall {
  method: string;
  body: Record<string, unknown>;
}

/** A stand-in for api.telegram.org that records every call. */
async function fakeTelegram(): Promise<{ server: Server; url: string; calls: ApiCall[] }> {
  const calls: ApiCall[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const method = (req.url ?? '').split('/').pop() ?? '';
      calls.push({ method, body: JSON.parse(raw || '{}') as Record<string, unknown> });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}`, calls };
}

function initData(tgUser: Record<string, unknown>, ageSec = 5, extra: Record<string, string> = {}) {
  const authDate = String(Math.floor(Date.now() / 1000) - ageSec);
  return signInitData({ auth_date: authDate, user: JSON.stringify(tgUser), ...extra }, TOKEN);
}

describe('Telegram sign-in and bot (integration)', () => {
  let ctx: TestContext;
  let tg: Awaited<ReturnType<typeof fakeTelegram>>;
  const ip = randomIp();
  const http = () => request(ctx.app.getHttpServer());
  const tgLogin = (body: Record<string, unknown>) =>
    http().post('/v1/auth/telegram').set('X-Forwarded-For', ip).send(body);

  beforeAll(async () => {
    tg = await fakeTelegram();
    ctx = await startTestApp({
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_BOT_USERNAME: 'kofclub_test_bot',
      TELEGRAM_WEBHOOK_SECRET: SECRET,
      TELEGRAM_MINI_APP_URL: MINI_APP,
      TELEGRAM_API_URL: tg.url,
      TELEGRAM_SUPPORT_CONTACT: '@kofclub_support',
    });
  });
  afterAll(async () => {
    await ctx.close();
    tg.server.close();
  });

  it('creates a Telegram-only account on request and signs it in afterwards', async () => {
    const dana = { id: 900000001, first_name: 'Dana', username: 'dana_tg' };
    const unknown = await tgLogin({ initData: initData(dana) }).expect(404);
    expect(unknown.body.error).toMatchObject({
      code: 'TELEGRAM_NOT_LINKED',
      details: { firstName: 'Dana', telegramUsername: 'dana_tg' },
    });

    const created = await tgLogin({ initData: initData(dana), create: true }).expect(200);
    expectSchema('AuthResult', created.body);
    expect(created.body.user).toMatchObject({
      username: 'dana_tg',
      email: null,
      hasPassword: false,
      telegram: { username: 'dana_tg', firstName: 'Dana' },
    });

    const again = await tgLogin({ initData: initData(dana) }).expect(200);
    expect(again.body.user.id).toBe(created.body.user.id);
    const me = await as(ctx.app, { accessToken: again.body.accessToken, ip })
      .get('/v1/me')
      .expect(200);
    expectSchema('User', me.body);

    // No password: password sign-in fails like any wrong password.
    const pw = await http()
      .post('/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ login: 'dana_tg', password: 'whatever-password' })
      .expect(401);
    expect(pw.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');

    // A second Telegram user with the same handle gets another name.
    const twin = await tgLogin({
      initData: initData({ id: 900000002, first_name: 'Dana', username: 'dana_tg' }),
      create: true,
    }).expect(200);
    expect(twin.body.user.username).toBe('Dana_0002');

    // Cannot unlink the only way to sign in.
    const unlink = await as(ctx.app, { accessToken: again.body.accessToken, ip })
      .delete('/v1/me/telegram')
      .expect(409);
    expect(unlink.body.error.code).toBe('CONFLICT');
  });

  it('rejects forged, foreign and stale init data', async () => {
    const user = { id: 900000003, first_name: 'Eve' };
    const forged = initData(user).replace('900000003', '900000004');
    for (const data of [
      forged,
      signInitData(
        { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user) },
        '1:' + 'Z'.repeat(35),
      ),
      initData(user, 7200),
    ]) {
      const res = await tgLogin({ initData: data, create: true }).expect(401);
      expect(res.body.error.code).toBe('TELEGRAM_AUTH_INVALID');
    }
    const rows = await ctx.db.query('SELECT 1 FROM telegram_accounts WHERE telegram_user_id = $1', [
      user.id,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it('links Telegram to an existing account, once', async () => {
    const owner = await registerUser(ctx.app, 'tglink');
    const other = await registerUser(ctx.app, 'tgother');
    const tgUser = { id: 900000010, first_name: 'Noa', username: 'noa_tg' };

    const linked = await as(ctx.app, owner)
      .post('/v1/me/telegram')
      .send({ initData: initData(tgUser) })
      .expect(200);
    expectSchema('User', linked.body);
    expect(linked.body).toMatchObject({
      id: owner.id,
      hasPassword: true,
      telegram: { username: 'noa_tg' },
    });

    const signedIn = await tgLogin({ initData: initData(tgUser) }).expect(200);
    expect(signedIn.body.user.id).toBe(owner.id);

    const taken = await as(ctx.app, other)
      .post('/v1/me/telegram')
      .send({ initData: initData(tgUser) })
      .expect(409);
    expect(taken.body.error.code).toBe('TELEGRAM_ALREADY_LINKED');
    const second = await as(ctx.app, owner)
      .post('/v1/me/telegram')
      .send({ initData: initData({ id: 900000011, first_name: 'Noa2' }) })
      .expect(409);
    expect(second.body.error.code).toBe('TELEGRAM_ALREADY_LINKED');

    await as(ctx.app, owner).delete('/v1/me/telegram').expect(204);
    expect((await as(ctx.app, owner).get('/v1/me').expect(200)).body.telegram).toBeNull();
    await tgLogin({ initData: initData(tgUser) }).expect(404);
  });

  it('never lets an account end up without a way to sign in', async () => {
    await expect(
      ctx.db.query(
        `INSERT INTO users (id, email, username, password_hash) VALUES (gen_random_uuid(), NULL, 'nobody_x', NULL)`,
      ),
    ).rejects.toThrow(/no way to sign in/);
  });

  it('answers bot commands through the webhook, only for Telegram', async () => {
    const config = await http().get('/v1/telegram/config').expect(200);
    expectSchema('TelegramConfig', config.body);
    expect(config.body).toEqual({
      enabled: true,
      botUsername: 'kofclub_test_bot',
      storeEnabled: false,
      operatorsEnabled: false,
    });

    const update = (text: string, chatType = 'private') => ({
      update_id: Date.now(),
      message: {
        message_id: 1,
        chat: { id: 555, type: chatType },
        from: { id: 555, first_name: 'Dana' },
        text,
      },
    });
    await http().post('/v1/telegram/webhook').send(update('/start')).expect(401);
    await http()
      .post('/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'wrong-secret-wrong-secret-wrong-secret')
      .send(update('/start'))
      .expect(401);
    expect(tg.calls).toHaveLength(0);

    const hook = (body: object) =>
      http().post('/v1/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', SECRET).send(body);
    await hook(update('/start c-ab12cd34')).expect(200);
    await hook(update('/terms')).expect(200);
    await hook(update('/paysupport')).expect(200);
    await hook(update('just chatting')).expect(200);
    await hook(update('/start', 'group')).expect(200);
    await hook(update('/start@kofclub_test_bot c-ab12cd34', 'group')).expect(200);
    await hook(update('/start@another_bot', 'group')).expect(200);
    await hook({ update_id: 1, edited_message: {} }).expect(200);

    // Commands for another bot in a group are not ours to answer.
    expect(tg.calls.map((c) => c.method)).toEqual(Array(5).fill('sendMessage'));
    const [start, terms, support, group, groupInvite] = tg.calls.map((c) => c.body);
    expect(start).toMatchObject({
      chat_id: 555,
      reply_markup: {
        inline_keyboard: [[{ web_app: { url: `${MINI_APP}/join?code=AB12CD34` } }]],
      },
    });
    expect(String(terms!.text)).toContain(`${MINI_APP}/terms`);
    expect(String(support!.text)).toContain('@kofclub_support');
    expect(group).toMatchObject({
      reply_markup: { inline_keyboard: [[{ url: 'https://t.me/kofclub_test_bot?startapp' }]] },
    });
    // In groups the club code travels in the t.me link.
    expect(groupInvite).toMatchObject({
      reply_markup: {
        inline_keyboard: [[{ url: 'https://t.me/kofclub_test_bot?startapp=c-AB12CD34' }]],
      },
    });
  });

  it('is off without a bot token', async () => {
    const plain = await startTestApp({}, { flushRedis: false });
    try {
      const res = await request(plain.app.getHttpServer())
        .post('/v1/auth/telegram')
        .send({ initData: initData({ id: 1, first_name: 'x' }) })
        .expect(503);
      expect(res.body.error.code).toBe('TELEGRAM_NOT_CONFIGURED');
      expect((await request(plain.app.getHttpServer()).get('/v1/telegram/config')).body).toEqual({
        enabled: false,
        botUsername: null,
        storeEnabled: false,
        operatorsEnabled: false,
      });
      await request(plain.app.getHttpServer())
        .post('/v1/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
        .send({ update_id: 1 })
        .expect(404);
    } finally {
      await plain.close();
    }
  });
});
