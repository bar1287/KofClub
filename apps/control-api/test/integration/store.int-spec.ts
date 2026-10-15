import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { signInitData } from '../../src/modules/telegram/init-data';
import { as, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';
import { enrollMfa } from './support/mfa';

const TOKEN = '123456789:' + 'S'.repeat(35); // test fixture, not a real bot
const SECRET = 'store-webhook-secret-' + 'y'.repeat(20); // test fixture

interface ApiCall {
  method: string;
  body: Record<string, unknown>;
}

/** A stand-in for the Bot API: records calls, answers like Telegram. */
async function fakeTelegram() {
  const calls: ApiCall[] = [];
  const results: Record<string, unknown> = {
    createInvoiceLink: 'https://t.me/$fake-invoice',
    answerPreCheckoutQuery: true,
    refundStarPayment: true,
    editUserStarSubscription: true,
  };
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const method = (req.url ?? '').split('/').pop() ?? '';
      calls.push({ method, body: JSON.parse(raw || '{}') as Record<string, unknown> });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result: results[method] ?? { message_id: 1 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const of = (method: string) => calls.filter((c) => c.method === method).map((c) => c.body);
  return { server, url: `http://127.0.0.1:${port}`, calls, of };
}

let nextUpdate = 1;
let nextTelegramId = 910_000_000;

describe('Telegram Stars store (integration)', () => {
  let ctx: TestContext;
  let tg: Awaited<ReturnType<typeof fakeTelegram>>;
  const hook = (update: Record<string, unknown>) =>
    request(ctx.app.getHttpServer())
      .post('/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
      .send({ update_id: nextUpdate++, ...update });

  /** Links a fresh Telegram account to the user; returns its Telegram id. */
  async function linkTelegram(user: TestUser): Promise<number> {
    const id = nextTelegramId++;
    const initData = signInitData(
      {
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id, first_name: user.username }),
      },
      TOKEN,
    );
    await as(ctx.app, user).post('/v1/me/telegram').send({ initData }).expect(200);
    return id;
  }

  const preCheckout = async (from: number, payload: string, amount: number) => {
    const queryId = randomUUID();
    await hook({
      pre_checkout_query: {
        id: queryId,
        from: { id: from, is_bot: false, first_name: 'x' },
        currency: 'XTR',
        total_amount: amount,
        invoice_payload: payload,
      },
    }).expect(200);
    return tg.of('answerPreCheckoutQuery').find((a) => a.pre_checkout_query_id === queryId)!;
  };

  const pay = (from: number, payment: Record<string, unknown>) =>
    hook({
      message: {
        message_id: nextUpdate,
        date: Math.floor(Date.now() / 1000),
        chat: { id: from, type: 'private' },
        from: { id: from, is_bot: false, first_name: 'x' },
        successful_payment: { currency: 'XTR', ...payment },
      },
    });

  const order = async (user: TestUser, body: Record<string, unknown>, expected = 201) =>
    as(ctx.app, user)
      .post('/v1/store/orders')
      .set('Idempotency-Key', `order-${randomUUID()}`)
      .send(body)
      .expect(expected);

  beforeAll(async () => {
    tg = await fakeTelegram();
    ctx = await startTestApp({
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_BOT_USERNAME: 'kofclub_store_bot',
      TELEGRAM_WEBHOOK_SECRET: SECRET,
      TELEGRAM_MINI_APP_URL: 'https://poker.example.test',
      TELEGRAM_API_URL: tg.url,
      TELEGRAM_SUPPORT_CONTACT: '@kofclub_support',
      TELEGRAM_STARS_ENABLED: 'true',
      CLUB_FREE_MAX_MEMBERS: '2',
      CLUB_FREE_MAX_OPEN_TABLES: '1',
      CLUB_PRO_MAX_MEMBERS: '3',
      CLUB_PRO_MAX_OPEN_TABLES: '2',
    });
  });
  afterAll(async () => {
    await ctx.close();
    tg.server.close();
  });

  it('sells Club Pro to the owner, lifts the club limits and renews monthly', async () => {
    const [owner, ana, ben] = await Promise.all([
      registerUser(ctx.app, 'proowner'),
      registerUser(ctx.app, 'ana'),
      registerUser(ctx.app, 'ben'),
    ]);
    const club = await as(ctx.app, owner)
      .post('/v1/clubs')
      .send({ name: 'Stars Club' })
      .expect(201);
    const clubId: string = club.body.id;
    const table = (name: string) =>
      as(ctx.app, owner)
        .post(`/v1/clubs/${clubId}/tables`)
        .send({ name, smallBlind: 5, bigBlind: 10, buyInMin: 200, buyInMax: 2000 });

    // Free plan: 2 members (the owner and Ana), 1 open table.
    await as(ctx.app, ana).post('/v1/clubs/join').send({ code: club.body.joinCode }).expect(200);
    const full = await as(ctx.app, ben)
      .post('/v1/clubs/join')
      .send({ code: club.body.joinCode })
      .expect(409);
    expect(full.body.error).toMatchObject({
      code: 'CLUB_PLAN_LIMIT',
      details: { kind: 'members', max: 2, plan: 'FREE' },
    });
    await table('First').expect(201);
    expect((await table('Second').expect(409)).body.error.details).toMatchObject({
      kind: 'openTables',
    });
    const free = await as(ctx.app, ana).get(`/v1/clubs/${clubId}/plan`).expect(200);
    expectSchema('ClubPlan', free.body);
    expect(free.body).toMatchObject({
      plan: 'FREE',
      limitsEnforced: true,
      limits: { maxMembers: 2, maxOpenTables: 1 },
      proLimits: { maxMembers: 3, maxOpenTables: 2 },
    });

    const store = await as(ctx.app, owner).get('/v1/store').expect(200);
    expectSchema('StoreCatalog', store.body);
    expect(store.body).toMatchObject({ enabled: true, botUsername: 'kofclub_store_bot' });
    const config = await request(ctx.app.getHttpServer()).get('/v1/telegram/config').expect(200);
    expect(config.body).toMatchObject({ enabled: true, storeEnabled: true });

    // Paying needs a linked Telegram account; Club Pro is for the owner only.
    const unlinked = await order(owner, { product: 'CLUB_PRO', clubId }, 404);
    expect(unlinked.body.error.code).toBe('TELEGRAM_NOT_LINKED');
    const ownerTg = await linkTelegram(owner);
    const anaTg = await linkTelegram(ana);
    expect((await order(ana, { product: 'CLUB_PRO', clubId }, 403)).body.error.code).toBe(
      'FORBIDDEN',
    );
    await order(owner, { product: 'CLUB_PRO' }, 400);

    const created = await order(owner, { product: 'CLUB_PRO', clubId });
    expectSchema('StarOrderCreated', created.body);
    const orderId: string = created.body.orderId;
    expect(tg.of('createInvoiceLink').at(-1)).toMatchObject({
      payload: orderId,
      currency: 'XTR',
      prices: [{ amount: 250 }],
      subscription_period: 2592000,
    });

    // Telegram asks before charging: only the payer, at the price.
    expect(await preCheckout(anaTg, orderId, 250)).toMatchObject({ ok: false });
    expect(await preCheckout(ownerTg, orderId, 1)).toMatchObject({ ok: false });
    expect(await preCheckout(ownerTg, 'not-an-order', 250)).toMatchObject({ ok: false });
    expect(await preCheckout(ownerTg, orderId, 250)).toEqual({
      pre_checkout_query_id: expect.any(String),
      ok: true,
    });

    const firstEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    const payment = {
      total_amount: 250,
      invoice_payload: orderId,
      telegram_payment_charge_id: `pro-${orderId}-1`,
      provider_payment_charge_id: '',
      is_recurring: true,
      is_first_recurring: true,
      subscription_expiration_date: firstEnd,
    };
    const thanksBefore = tg.of('sendMessage').length;
    await pay(ownerTg, payment).expect(200);
    await pay(ownerTg, payment).expect(200); // delivered twice: recorded once
    expect(tg.of('sendMessage').slice(thanksBefore)).toEqual([
      expect.objectContaining({
        chat_id: ownerTg,
        text: expect.stringContaining('Club Pro is active'),
      }),
    ]);
    const pro = await as(ctx.app, owner).get(`/v1/clubs/${clubId}/plan`).expect(200);
    expect(pro.body).toMatchObject({
      plan: 'PRO',
      renewing: true,
      canManageRenewal: true,
      limits: { maxMembers: 3, maxOpenTables: 2 },
      activeUntil: new Date(firstEnd * 1000).toISOString(),
    });
    expect(await preCheckout(ownerTg, orderId, 250)).toMatchObject({ ok: false });

    // Club Pro limits apply now.
    await as(ctx.app, ben).post('/v1/clubs/join').send({ code: club.body.joinCode }).expect(200);
    await table('Second').expect(201);

    // Telegram renews the subscription with a new charge.
    await pay(ownerTg, {
      ...payment,
      telegram_payment_charge_id: `pro-${orderId}-2`,
      is_first_recurring: false,
      subscription_expiration_date: firstEnd + 30 * 86400,
    }).expect(200);
    const renewed = await as(ctx.app, owner).get(`/v1/clubs/${clubId}/plan`).expect(200);
    expect(renewed.body.activeUntil).toBe(new Date((firstEnd + 30 * 86400) * 1000).toISOString());

    // Only the subscriber manages the renewal, through Telegram.
    await as(ctx.app, ana)
      .put(`/v1/clubs/${clubId}/plan/renewal`)
      .send({ renewing: false })
      .expect(403);
    const canceled = await as(ctx.app, owner)
      .put(`/v1/clubs/${clubId}/plan/renewal`)
      .send({ renewing: false })
      .expect(200);
    expect(canceled.body).toMatchObject({ plan: 'PRO', renewing: false });
    expect(tg.of('editUserStarSubscription').at(-1)).toEqual({
      user_id: ownerTg,
      telegram_payment_charge_id: `pro-${orderId}-1`,
      is_canceled: true,
    });

    const mine = await as(ctx.app, owner).get('/v1/me/store').expect(200);
    expectSchema('MyStore', mine.body);
    expect(mine.body.payments).toHaveLength(2);
    expect(mine.body.payments.map((p: { recurring: boolean }) => p.recurring)).toEqual([
      true,
      false,
    ]);
    const audit = await ctx.db.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE club_id = $1 AND action LIKE 'CLUB_PRO_%' ORDER BY created_at`,
      [clubId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'CLUB_PRO_STARTED',
      'CLUB_PRO_RENEWED',
      'CLUB_PRO_RENEWAL_CANCELED',
    ]);
    // Nothing in the store touches chips.
    const ledger = await ctx.db.query(
      `SELECT count(*)::int AS n FROM ledger_transactions WHERE club_id = $1`,
      [clubId],
    );
    expect(ledger.rows[0].n).toBe(0);
  });

  it('sells themes and tips; admins refund and take back what was bought', async () => {
    const [buyer, admin] = await Promise.all([
      registerUser(ctx.app, 'buyer'),
      registerUser(ctx.app, 'stadmin'),
    ]);
    const buyerTg = await linkTelegram(buyer);
    const themes = await order(buyer, { product: 'PREMIUM_THEMES' });
    expect(await preCheckout(buyerTg, themes.body.orderId, 150)).toMatchObject({ ok: true });
    await pay(buyerTg, {
      total_amount: 150,
      invoice_payload: themes.body.orderId,
      telegram_payment_charge_id: `themes-${themes.body.orderId}`,
    }).expect(200);
    const owned = await as(ctx.app, buyer).get('/v1/me/store').expect(200);
    expect(owned.body.entitlements).toEqual(['PREMIUM_THEMES']);
    const catalog = await as(ctx.app, buyer).get('/v1/store').expect(200);
    expect(catalog.body.products.find((p: { id: string }) => p.id === 'PREMIUM_THEMES').owned).toBe(
      true,
    );
    expect((await order(buyer, { product: 'PREMIUM_THEMES' }, 409)).body.error.code).toBe(
      'CONFLICT',
    );

    const tip = await order(buyer, { product: 'TIP_SMALL' });
    await pay(buyerTg, {
      total_amount: 50,
      invoice_payload: tip.body.orderId,
      telegram_payment_charge_id: `tip-${tip.body.orderId}`,
    }).expect(200);
    expect(tg.of('sendMessage').at(-1)).toMatchObject({ text: expect.stringContaining('tip') });

    // A payment that matches no order is kept, so it can be refunded.
    await pay(buyerTg, {
      total_amount: 77,
      invoice_payload: 'something-else',
      telegram_payment_charge_id: `stray-${randomUUID()}`,
    }).expect(200);
    expect(tg.of('sendMessage').at(-1)).toMatchObject({
      text: expect.stringContaining('/paysupport'),
    });

    // Platform administrators list and refund payments (MFA, audited).
    await ctx.db.query(`UPDATE users SET platform_role = 'PLATFORM_ADMIN' WHERE id = $1`, [
      admin.id,
    ]);
    await as(ctx.app, buyer).get('/v1/admin/star-payments').expect(403);
    await enrollMfa(ctx.app, admin);
    const page = await as(ctx.app, admin).get('/v1/admin/star-payments?limit=2').expect(200);
    expectSchema('StarPaymentPage', page.body);
    expect(page.body.items).toHaveLength(2);
    expect(page.body.items[0]).toMatchObject({ product: null, stars: 77 });
    const next = await as(ctx.app, admin)
      .get(`/v1/admin/star-payments?limit=2&cursor=${page.body.nextCursor}`)
      .expect(200);
    expect(next.body.items[0]).toMatchObject({
      product: 'PREMIUM_THEMES',
      username: buyer.username,
    });

    const themesPayment = next.body.items[0];
    const refunded = await as(ctx.app, admin)
      .post(`/v1/admin/star-payments/${themesPayment.id}/refund`)
      .send({ reason: 'Bought by mistake' })
      .expect(200);
    expectSchema('StarPayment', refunded.body);
    expect(refunded.body).toMatchObject({ refundReason: 'Bought by mistake' });
    expect(tg.of('refundStarPayment').at(-1)).toEqual({
      user_id: buyerTg,
      telegram_payment_charge_id: `themes-${themes.body.orderId}`,
    });
    expect((await as(ctx.app, buyer).get('/v1/me/store')).body.entitlements).toEqual([]);
    await as(ctx.app, admin)
      .post(`/v1/admin/star-payments/${themesPayment.id}/refund`)
      .send({ reason: 'again' })
      .expect(409);
    const audit = await ctx.db.query(
      `SELECT actor_user_id FROM audit_log WHERE action = 'STAR_PAYMENT_REFUNDED' AND object_id = $1`,
      [themesPayment.id],
    );
    expect(audit.rows).toEqual([{ actor_user_id: admin.id }]);

    // Telegram reports a refund it made itself.
    await hook({
      message: {
        message_id: 1,
        date: 1,
        chat: { id: buyerTg, type: 'private' },
        from: { id: buyerTg, is_bot: false, first_name: 'x' },
        refunded_payment: {
          currency: 'XTR',
          total_amount: 50,
          invoice_payload: tip.body.orderId,
          telegram_payment_charge_id: `tip-${tip.body.orderId}`,
        },
      },
    }).expect(200);
    const tipRow = await ctx.db.query(
      `SELECT refund_reason FROM star_payments WHERE telegram_charge_id = $1`,
      [`tip-${tip.body.orderId}`],
    );
    expect(tipRow.rows).toEqual([{ refund_reason: 'Refunded by Telegram' }]);
  });

  it('ends Club Pro when its payment is refunded', async () => {
    const owner = await registerUser(ctx.app, 'refowner');
    const ownerTg = await linkTelegram(owner);
    const club = await as(ctx.app, owner)
      .post('/v1/clubs')
      .send({ name: 'Refund Club' })
      .expect(201);
    const clubId: string = club.body.id;
    const created = await order(owner, { product: 'CLUB_PRO', clubId });
    await pay(ownerTg, {
      total_amount: 250,
      invoice_payload: created.body.orderId,
      telegram_payment_charge_id: `pro-${created.body.orderId}`,
      is_recurring: true,
      is_first_recurring: true,
      subscription_expiration_date: Math.floor(Date.now() / 1000) + 30 * 86400,
    }).expect(200);
    expect((await as(ctx.app, owner).get(`/v1/clubs/${clubId}/plan`)).body.plan).toBe('PRO');

    await hook({
      message: {
        message_id: 1,
        date: 1,
        chat: { id: ownerTg, type: 'private' },
        from: { id: ownerTg, is_bot: false, first_name: 'x' },
        refunded_payment: {
          currency: 'XTR',
          total_amount: 250,
          invoice_payload: created.body.orderId,
          telegram_payment_charge_id: `pro-${created.body.orderId}`,
        },
      },
    }).expect(200);
    const plan = await as(ctx.app, owner).get(`/v1/clubs/${clubId}/plan`).expect(200);
    expect(plan.body).toMatchObject({ plan: 'FREE', renewing: false, activeUntil: null });
  });

  it('is off unless enabled: no purchases and no plan limits', async () => {
    const plain = await startTestApp({}, { flushRedis: false });
    try {
      const user = await registerUser(plain.app, 'nostore');
      const store = await as(plain.app, user).get('/v1/store').expect(200);
      expect(store.body).toMatchObject({ enabled: false, botUsername: null });
      const res = await as(plain.app, user)
        .post('/v1/store/orders')
        .send({ product: 'TIP_SMALL' })
        .expect(503);
      expect(res.body.error.code).toBe('STORE_DISABLED');
      const club = await as(plain.app, user).post('/v1/clubs').send({ name: 'Free Club' });
      const plan = await as(plain.app, user).get(`/v1/clubs/${club.body.id}/plan`).expect(200);
      expect(plan.body).toMatchObject({ plan: 'FREE', limitsEnforced: false });
    } finally {
      await plain.close();
    }
  });
});
