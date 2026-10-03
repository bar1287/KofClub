import { randomUUID } from 'node:crypto';
import { as, registerUser, TestUser } from './support/api';
import { startTestApp, TestContext } from './support/app';
import { expectSchema } from './support/contract';

describe('ledger (integration)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let admin: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let clubId: string;

  const key = () => `key-${randomUUID()}`;
  const grant = (actor: TestUser, userId: string, amount: number, k = key()) =>
    as(ctx.app, actor)
      .post(`/v1/clubs/${clubId}/chips/grants`)
      .set('Idempotency-Key', k)
      .send({ userId, amount, note: 'welcome bonus' });

  beforeAll(async () => {
    ctx = await startTestApp();
    [owner, admin, member, outsider] = await Promise.all([
      registerUser(ctx.app, 'owner'),
      registerUser(ctx.app, 'admin'),
      registerUser(ctx.app, 'member'),
      registerUser(ctx.app, 'outsider'),
    ]);
    const club = await as(ctx.app, owner)
      .post('/v1/clubs')
      .send({ name: 'Ledger Club' })
      .expect(201);
    clubId = club.body.id;
    for (const u of [admin, member]) {
      await as(ctx.app, u).post('/v1/clubs/join').send({ code: club.body.joinCode }).expect(200);
    }
    await as(ctx.app, owner)
      .patch(`/v1/clubs/${clubId}/members/${admin.id}`)
      .send({ role: 'ADMIN' })
      .expect(200);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('admins grant chips from the treasury; members see their wallet', async () => {
    const res = await grant(admin, member.id, 5000).expect(201);
    expectSchema('LedgerTransaction', res.body);
    expect(res.body).toMatchObject({
      kind: 'CLUB_GRANT',
      actorUserId: admin.id,
      metadata: { note: 'welcome bonus' },
    });
    const amounts = res.body.entries.map((e: { accountKind: string; amount: number }) => [
      e.accountKind,
      e.amount,
    ]);
    expect(amounts).toEqual([
      ['CLUB_TREASURY', -5000],
      ['MEMBER_WALLET', 5000],
    ]);

    const wallet = await as(ctx.app, member).get(`/v1/clubs/${clubId}/wallet`).expect(200);
    expectSchema('Wallet', wallet.body);
    expect(wallet.body.balance).toBe(5000);
    const entries = await as(ctx.app, member).get(`/v1/clubs/${clubId}/wallet/entries`).expect(200);
    expectSchema('WalletEntryPage', entries.body);
    expect(entries.body.items[0]).toMatchObject({
      kind: 'CLUB_GRANT',
      amount: 5000,
      balanceAfter: 5000,
    });
  });

  it('requires an Idempotency-Key and never applies a retried grant twice', async () => {
    const missing = await as(ctx.app, admin)
      .post(`/v1/clubs/${clubId}/chips/grants`)
      .send({ userId: member.id, amount: 10 })
      .expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_FAILED');

    const before = (await as(ctx.app, member).get(`/v1/clubs/${clubId}/wallet`)).body.balance;
    const k = key();
    const a = await grant(admin, member.id, 250, k).expect(201);
    const b = await grant(admin, member.id, 250, k).expect(201);
    expect(b.body.id).toBe(a.body.id);
    const after = (await as(ctx.app, member).get(`/v1/clubs/${clubId}/wallet`)).body.balance;
    expect(after - before).toBe(250);

    const conflict = await grant(admin, member.id, 999, k).expect(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('enforces RBAC, membership and tenant isolation for chip movements', async () => {
    expect((await grant(member, member.id, 100).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await grant(outsider, member.id, 100).expect(403)).body.error.code).toBe(
      'NOT_CLUB_MEMBER',
    );
    expect((await grant(admin, outsider.id, 100).expect(403)).body.error.code).toBe(
      'NOT_CLUB_MEMBER',
    );
    await as(ctx.app, member).get(`/v1/clubs/${clubId}/ledger/summary`).expect(403);
    await as(ctx.app, outsider).get(`/v1/clubs/${clubId}/wallet`).expect(403);

    // An admin of another club cannot touch this club's ledger.
    const other = await as(ctx.app, outsider)
      .post('/v1/clubs')
      .send({ name: 'Other Ledger Club' })
      .expect(201);
    await as(ctx.app, outsider)
      .post(`/v1/clubs/${other.body.id}/chips/grants`)
      .set('Idempotency-Key', key())
      .send({ userId: member.id, amount: 100 })
      .expect(403);
  });

  it('validates amounts as positive integers', async () => {
    for (const amount of [0, -5, 1.5, '100', 2e18]) {
      const res = await as(ctx.app, admin)
        .post(`/v1/clubs/${clubId}/chips/grants`)
        .set('Idempotency-Key', key())
        .send({ userId: member.id, amount });
      expect(res.status).toBe(400);
    }
  });

  it('deductions cannot overdraw a wallet', async () => {
    const balance = (await as(ctx.app, member).get(`/v1/clubs/${clubId}/wallet`)).body
      .balance as number;
    const res = await as(ctx.app, admin)
      .post(`/v1/clubs/${clubId}/chips/deductions`)
      .set('Idempotency-Key', key())
      .send({ userId: member.id, amount: balance + 1 })
      .expect(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_CHIPS');
    const ok = await as(ctx.app, admin)
      .post(`/v1/clubs/${clubId}/chips/deductions`)
      .set('Idempotency-Key', key())
      .send({ userId: member.id, amount: 100 })
      .expect(201);
    expect(ok.body.kind).toBe('CLUB_DEDUCTION');
    expect((await as(ctx.app, member).get(`/v1/clubs/${clubId}/wallet`)).body.balance).toBe(
      balance - 100,
    );
  });

  it('reverses administrative movements exactly once', async () => {
    const g = await grant(admin, member.id, 777).expect(201);
    const before = (await as(ctx.app, member).get(`/v1/clubs/${clubId}/wallet`)).body.balance;
    const rev = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/ledger/transactions/${g.body.id}/reversal`)
      .set('Idempotency-Key', key())
      .send({ note: 'granted to the wrong member' })
      .expect(201);
    expectSchema('LedgerTransaction', rev.body);
    expect(rev.body).toMatchObject({ kind: 'REVERSAL', reversesTxId: g.body.id });
    expect((await as(ctx.app, member).get(`/v1/clubs/${clubId}/wallet`)).body.balance).toBe(
      before - 777,
    );

    const again = await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/ledger/transactions/${g.body.id}/reversal`)
      .set('Idempotency-Key', key())
      .send({ note: 'again' })
      .expect(409);
    expect(again.body.error.code).toBe('CONFLICT');
    await as(ctx.app, owner)
      .post(`/v1/clubs/${clubId}/ledger/transactions/${randomUUID()}/reversal`)
      .set('Idempotency-Key', key())
      .send({ note: 'x' })
      .expect(404);
  });

  it('reports circulation, balances and transactions consistently', async () => {
    await grant(owner, owner.id, 1000).expect(201);
    const summary = await as(ctx.app, admin).get(`/v1/clubs/${clubId}/ledger/summary`).expect(200);
    expectSchema('LedgerSummary', summary.body);
    expect(summary.body.issued).toBe(summary.body.inWallets + summary.body.atTables);

    const balances = await as(ctx.app, admin)
      .get(`/v1/clubs/${clubId}/ledger/balances?limit=2`)
      .expect(200);
    expectSchema('MemberBalancePage', balances.body);
    expect(balances.body.items).toHaveLength(2);
    const rest = await as(ctx.app, admin)
      .get(`/v1/clubs/${clubId}/ledger/balances?cursor=${balances.body.nextCursor}`)
      .expect(200);
    const all = [...balances.body.items, ...rest.body.items];
    expect(all.reduce((s: number, b: { walletBalance: number }) => s + b.walletBalance, 0)).toBe(
      summary.body.inWallets,
    );

    const txs = await as(ctx.app, admin)
      .get(`/v1/clubs/${clubId}/ledger/transactions?limit=100`)
      .expect(200);
    expectSchema('LedgerTransactionPage', txs.body);
    for (const tx of txs.body.items as Array<{ entries: Array<{ amount: number }> }>) {
      expect(tx.entries.reduce((s, e) => s + e.amount, 0)).toBe(0);
    }

    // Self-grants are allowed but flagged for review; every grant is audited.
    const risk = await ctx.db.query(
      `SELECT type FROM risk_events WHERE subject_user_id = $1 AND club_id = $2`,
      [owner.id, clubId],
    );
    expect(risk.rows.map((r) => r.type)).toContain('SELF_CHIP_GRANT');
    const audit = await as(ctx.app, owner)
      .get(`/v1/clubs/${clubId}/audit-log?limit=100`)
      .expect(200);
    const actions = audit.body.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['CHIPS_GRANTED', 'CHIPS_DEDUCTED', 'LEDGER_REVERSED']),
    );

    const violations = await ctx.db.query('SELECT * FROM ledger_invariant_violations');
    expect(violations.rows).toEqual([]);
  });
});
