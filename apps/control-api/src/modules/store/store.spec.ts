import { loadConfig } from '../../config/config';
import { catalog, PRODUCT_IDS, SUBSCRIPTION_PERIOD_SECONDS } from './store.catalog';
import type { StarOrderRow } from './store.repository';
import { checkoutProblem } from './store.service';
import { alreadyRefunded, isRenewal, successfulPaymentSchema } from './telegram-payments';

const config = loadConfig({
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
  AUTH_JWT_PRIVATE_KEY_B64: 'x',
  AUTH_JWT_PUBLIC_KEY_B64: 'y',
  IP_HASH_SECRET: 'h'.repeat(32), // test fixture, not a secret
  MFA_ENCRYPTION_KEY_B64: Buffer.alloc(32).toString('base64'), // test fixture
  INTERNAL_SERVICE_TOKEN: 'x'.repeat(32),
});

describe('Stars store catalog', () => {
  it('sells only digital goods that fit Telegram invoices', () => {
    const products = catalog(config);
    expect(products.map((p) => p.id)).toEqual([...PRODUCT_IDS]);
    for (const p of products) {
      expect(p.title.length).toBeLessThanOrEqual(32);
      expect(p.description.length).toBeLessThanOrEqual(255);
      expect(p.stars).toBeGreaterThanOrEqual(1);
      expect(p.stars).toBeLessThanOrEqual(10000);
      // Never chips, seats, entries or prizes (ADR-018).
      expect(`${p.title} ${p.description}`).not.toMatch(/buy[- ]?in|prize|cash|entry fee/i);
    }
    const pro = products.find((p) => p.id === 'CLUB_PRO')!;
    expect(pro).toMatchObject({ kind: 'SUBSCRIPTION', periodDays: 30, stars: 250 });
    expect(pro.description).toContain('30 open tables');
    expect(SUBSCRIPTION_PERIOD_SECONDS).toBe(30 * 24 * 3600);
    expect(products.find((p) => p.id === 'PREMIUM_THEMES')!.entitlement).toBe('PREMIUM_THEMES');
  });
});

describe('checkoutProblem', () => {
  const order: StarOrderRow = {
    id: '0191a000-0000-7000-8000-000000000001',
    userId: '0191a000-0000-7000-8000-00000000000a',
    telegramUserId: 42,
    product: 'PREMIUM_THEMES',
    clubId: null,
    stars: 150,
    status: 'PENDING',
    createdAt: new Date(),
  };
  const query = {
    id: 'q1',
    from: { id: 42 },
    currency: 'XTR',
    total_amount: 150,
    invoice_payload: order.id,
  };

  it('accepts only the payer of a pending order, in Stars, at its price', () => {
    expect(checkoutProblem(order, query)).toBeNull();
    expect(checkoutProblem(null, query)).toMatch(/not found/);
    expect(checkoutProblem({ ...order, status: 'PAID' }, query)).toMatch(/already paid/);
    expect(checkoutProblem(order, { ...query, currency: 'USD' })).toMatch(/Stars/);
    expect(checkoutProblem(order, { ...query, from: { id: 43 } })).toMatch(/own account/);
    expect(checkoutProblem(order, { ...query, total_amount: 1 })).toMatch(/price/);
  });
});

describe('Telegram payment updates', () => {
  const base = {
    currency: 'XTR',
    total_amount: 250,
    invoice_payload: 'x',
    telegram_payment_charge_id: 'ch_1',
  };

  it('tells renewals from first payments', () => {
    const first = successfulPaymentSchema.parse({
      ...base,
      is_recurring: true,
      is_first_recurring: true,
      subscription_expiration_date: 1_900_000_000,
      provider_payment_charge_id: 'ignored',
    });
    expect(isRenewal(first)).toBe(false);
    expect(isRenewal({ ...first, is_first_recurring: false })).toBe(true);
    expect(isRenewal(successfulPaymentSchema.parse(base))).toBe(false);
    expect(successfulPaymentSchema.safeParse({ ...base, total_amount: 0 }).success).toBe(false);
  });

  it('recognizes an already refunded charge', () => {
    expect(alreadyRefunded('Bad Request: CHARGE_ALREADY_REFUNDED')).toBe(true);
    expect(alreadyRefunded('Bad Request: CHARGE_NOT_FOUND')).toBe(false);
  });
});
