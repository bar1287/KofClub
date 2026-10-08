import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import request from 'supertest';
import { as, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';
import { waitFor } from './support/game';

interface BusFrame {
  tableId: string;
  frame: { type: string; tableId: string; message?: Record<string, unknown>; messageId?: string };
}

describe('table chat (integration)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let outsider: TestUser;
  let clubId: string;
  let tableId: string;
  let otherTableId: string;
  let sub: Redis;
  const bus: BusFrame[] = [];

  /** CHAT_SEND as forwarded by the realtime gateway. */
  const send = (body: Record<string, unknown>, table = tableId) =>
    request(ctx.app.getHttpServer())
      .post(`/internal/v1/tables/${table}/chat`)
      .set('Authorization', `Bearer ${ctx.config.INTERNAL_SERVICE_TOKEN}`)
      .send({ requestId: randomUUID(), ...body });
  const onBus = (table = tableId) => bus.filter((b) => b.tableId === table);
  const until = (what: string, pred: () => boolean) =>
    waitFor(what, async () => (pred() ? true : undefined));

  beforeAll(async () => {
    ctx = await startTestApp();
    sub = new Redis(ctx.config.REDIS_URL);
    await sub.subscribe('table:chat');
    sub.on('message', (_channel, raw: string) => bus.push(JSON.parse(raw) as BusFrame));
    [owner, alice, bob, carol, outsider] = await Promise.all([
      registerUser(ctx.app, 'owner'),
      registerUser(ctx.app, 'alice'),
      registerUser(ctx.app, 'bob'),
      registerUser(ctx.app, 'carol'),
      registerUser(ctx.app, 'outsider'),
    ]);
    const club = await as(ctx.app, owner).post('/v1/clubs').send({ name: 'Chat Club' }).expect(201);
    clubId = club.body.id;
    expect(club.body.tableChat).toBe(true);
    for (const u of [alice, bob, carol]) {
      await as(ctx.app, u).post('/v1/clubs/join').send({ code: club.body.joinCode }).expect(200);
    }
    const stakes = { smallBlind: 1, bigBlind: 2, buyInMin: 40, buyInMax: 400 };
    tableId = (
      await as(ctx.app, owner)
        .post(`/v1/clubs/${clubId}/tables`)
        .send({ name: 'Chatty', ...stakes })
        .expect(201)
    ).body.id;
    otherTableId = (
      await as(ctx.app, owner)
        .post(`/v1/clubs/${clubId}/tables`)
        .send({ name: 'Quiet', ...stakes })
        .expect(201)
    ).body.id;
  });
  afterAll(async () => {
    sub.disconnect();
    await ctx.close();
  });

  it('stores a message once, cleans it and hands it to the gateways', async () => {
    const requestId = randomUUID();
    const res = await send({ userId: alice.id, requestId, text: '  nice\n\n hand ‮ok ' }).expect(
      200,
    );
    expect(res.body.published).toBe(true);
    const message = res.body.message;
    expectSchema('ChatMessage', message);
    expect(message).toMatchObject({
      tableId,
      kind: 'MESSAGE',
      userId: alice.id,
      username: alice.username,
      text: 'nice hand ok',
    });
    await until('message on the chat bus', () => onBus().length === 1);
    expect(onBus()[0]!.frame).toEqual({ type: 'CHAT_MESSAGE', tableId, message });
    expectSchema('ChatMessageFrame', onBus()[0]!.frame);

    // A retried CHAT_SEND returns the stored message and is not delivered again.
    const again = await send({ userId: alice.id, requestId, text: 'nice hand' }).expect(200);
    expect(again.body.message).toEqual(message);
    const rows = await ctx.db.query('SELECT body FROM chat_messages WHERE table_id = $1', [
      tableId,
    ]);
    expect(rows.rows).toEqual([{ body: 'nice hand ok' }]);

    await send({ userId: bob.id, text: 'thanks' }).expect(200);
    const history = (await as(ctx.app, carol).get(`/v1/tables/${tableId}/chat`).expect(200)).body;
    expectSchema('ChatHistory', history);
    expect(history).toMatchObject({ tableId, enabled: true, canSend: true });
    expect(history.items.map((m: { text: string }) => m.text)).toEqual(['nice hand ok', 'thanks']);
    expect((await as(ctx.app, carol).get(`/v1/tables/${otherTableId}/chat`)).body.items).toEqual(
      [],
    );
    await until('both messages delivered', () => onBus().length === 2);
  });

  it('delivers reactions without storing them', async () => {
    const res = await send({ userId: bob.id, emoji: '🔥' }).expect(200);
    expectSchema('ChatMessage', res.body.message);
    expect(res.body.message).toMatchObject({ kind: 'REACTION', emoji: '🔥', userId: bob.id });
    expect(res.body.message.text).toBeUndefined();
    await until('reaction on the bus', () =>
      onBus().some((b) => b.frame.message?.kind === 'REACTION'),
    );
    const count = await ctx.db.query('SELECT count(*)::int AS n FROM chat_messages');
    expect(count.rows[0].n).toBe(2);
  });

  it('rejects bad messages, outsiders, closed chat and floods', async () => {
    for (const body of [
      { userId: bob.id, emoji: '💩' },
      { userId: bob.id, text: 'hi', emoji: '🔥' },
      { userId: bob.id },
      { userId: bob.id, text: ' \n\t ' },
      { userId: bob.id, text: 'x'.repeat(201) },
    ]) {
      const bad = await send(body).expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    }
    // Exactly 200 characters (code points, so emoji count once) is fine.
    await send({ userId: bob.id, text: '🙂'.repeat(200) }).expect(200);

    expect((await send({ userId: outsider.id, text: 'hello' }).expect(403)).body.error.code).toBe(
      'NOT_CLUB_MEMBER',
    );
    expect(
      (await send({ userId: alice.id, text: 'hello' }, randomUUID()).expect(404)).body.error.code,
    ).toBe('TABLE_NOT_FOUND');
    expect(
      (await as(ctx.app, outsider).get(`/v1/tables/${tableId}/chat`).expect(403)).body.error.code,
    ).toBe('NOT_CLUB_MEMBER');
    await request(ctx.app.getHttpServer())
      .post(`/internal/v1/tables/${tableId}/chat`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ userId: alice.id, requestId: randomUUID(), text: 'not a service' })
      .expect(401);

    // Five messages per ten seconds per player.
    for (let i = 0; i < 5; i++) await send({ userId: carol.id, text: `spam ${i}` }).expect(200);
    const flood = await send({ userId: carol.id, text: 'spam 5' }).expect(429);
    expect(flood.body.error.code).toBe('RATE_LIMITED');

    // Only the owner turns chat off; then nothing is sent or shown.
    await as(ctx.app, alice).patch(`/v1/clubs/${clubId}`).send({ tableChat: false }).expect(403);
    const off = await as(ctx.app, owner)
      .patch(`/v1/clubs/${clubId}`)
      .send({ tableChat: false })
      .expect(200);
    expectSchema('Club', off.body);
    expect(off.body.tableChat).toBe(false);
    expect((await send({ userId: alice.id, text: 'hello?' }).expect(403)).body.error.code).toBe(
      'CHAT_DISABLED',
    );
    expect((await send({ userId: alice.id, emoji: '👍' }).expect(403)).body.error.code).toBe(
      'CHAT_DISABLED',
    );
    expect((await as(ctx.app, alice).get(`/v1/tables/${tableId}/chat`).expect(200)).body).toEqual({
      tableId,
      enabled: false,
      canSend: false,
      items: [],
    });
    await as(ctx.app, owner).patch(`/v1/clubs/${clubId}`).send({ tableChat: true }).expect(200);
  });

  it('lets players report messages and staff hide them', async () => {
    const posted = await send({ userId: alice.id, text: 'something rude' }).expect(200);
    const messageId = posted.body.message.id as string;

    const own = await as(ctx.app, alice)
      .post(`/v1/tables/${tableId}/chat/reports`)
      .send({ messageId })
      .expect(400);
    expect(own.body.error.code).toBe('VALIDATION_FAILED');
    const elsewhere = await as(ctx.app, bob)
      .post(`/v1/tables/${otherTableId}/chat/reports`)
      .send({ messageId })
      .expect(404);
    expect(elsewhere.body.error.code).toBe('NOT_FOUND');
    await as(ctx.app, outsider)
      .post(`/v1/tables/${tableId}/chat/reports`)
      .send({ messageId })
      .expect(403);

    const report = await as(ctx.app, bob)
      .post(`/v1/tables/${tableId}/chat/reports`)
      .send({ messageId, reason: 'insulting' })
      .expect(200);
    expectSchema('ChatReport', report.body);
    expect(report.body).toMatchObject({
      clubId,
      tableId,
      messageId,
      reportedUserId: alice.id,
      reportedUsername: alice.username,
      reporterUserId: bob.id,
      text: 'something rude',
      reason: 'insulting',
      status: 'OPEN',
      resolvedAt: null,
    });
    const repeat = await as(ctx.app, bob)
      .post(`/v1/tables/${tableId}/chat/reports`)
      .send({ messageId })
      .expect(200);
    expect(repeat.body.id).toBe(report.body.id);
    const second = await as(ctx.app, carol)
      .post(`/v1/tables/${tableId}/chat/reports`)
      .send({ messageId })
      .expect(200);

    // Staff only (ADMIN+).
    await as(ctx.app, alice).get(`/v1/clubs/${clubId}/chat-reports`).expect(403);
    const open = await as(ctx.app, owner)
      .get(`/v1/clubs/${clubId}/chat-reports?status=OPEN`)
      .expect(200);
    expectSchema('ChatReportPage', open.body);
    expect(open.body.items.map((r: { id: string }) => r.id)).toEqual([
      second.body.id,
      report.body.id,
    ]);
    const firstPage = await as(ctx.app, owner)
      .get(`/v1/clubs/${clubId}/chat-reports?limit=1`)
      .expect(200);
    expect(firstPage.body.items).toHaveLength(1);
    const nextPage = await as(ctx.app, owner)
      .get(`/v1/clubs/${clubId}/chat-reports?limit=1&cursor=${firstPage.body.nextCursor}`)
      .expect(200);
    expect(nextPage.body.items[0].id).toBe(report.body.id);

    await as(ctx.app, bob)
      .post(`/v1/clubs/${clubId}/chat-reports/${report.body.id}/resolve`)
      .send({ action: 'HIDE' })
      .expect(403);
    const hidden = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/chat-reports/${report.body.id}/resolve`)
      .send({ action: 'HIDE' })
      .expect(200);
    expectSchema('ChatReport', hidden.body);
    expect(hidden.body.status).toBe('HIDDEN');
    expect(hidden.body.resolvedAt).not.toBeNull();
    await until('CHAT_HIDDEN on the bus', () =>
      onBus().some((b) => b.frame.type === 'CHAT_HIDDEN'),
    );
    const frame = onBus().find((b) => b.frame.type === 'CHAT_HIDDEN')!.frame;
    expectSchema('ChatHiddenFrame', frame);
    expect(frame).toEqual({ type: 'CHAT_HIDDEN', tableId, messageId });

    // Hiding resolves every open report of the message; it leaves the history.
    const all = await as(ctx.app, owner).get(`/v1/clubs/${clubId}/chat-reports`).expect(200);
    expect(all.body.items.map((r: { status: string }) => r.status)).toEqual(['HIDDEN', 'HIDDEN']);
    const history = (await as(ctx.app, bob).get(`/v1/tables/${tableId}/chat`).expect(200)).body;
    expect(history.items.some((m: { id: string }) => m.id === messageId)).toBe(false);
    const again = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/chat-reports/${second.body.id}/resolve`)
      .send({ action: 'DISMISS' })
      .expect(409);
    expect(again.body.error.code).toBe('CONFLICT');

    // Dismissing keeps the message.
    const kept = await send({ userId: bob.id, text: 'gg' }).expect(200);
    const another = await as(ctx.app, alice)
      .post(`/v1/tables/${tableId}/chat/reports`)
      .send({ messageId: kept.body.message.id })
      .expect(200);
    const dismissed = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/chat-reports/${another.body.id}/resolve`)
      .send({ action: 'DISMISS' })
      .expect(200);
    expect(dismissed.body.status).toBe('DISMISSED');
    const after = (await as(ctx.app, bob).get(`/v1/tables/${tableId}/chat`).expect(200)).body;
    expect(after.items.some((m: { id: string }) => m.id === kept.body.message.id)).toBe(true);

    const audit = await ctx.db.query(
      `SELECT action FROM audit_log WHERE club_id = $1 AND action LIKE 'CHAT_%' ORDER BY created_at`,
      [clubId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'CHAT_MESSAGE_HIDDEN',
      'CHAT_REPORT_DISMISSED',
    ]);
  });
});
