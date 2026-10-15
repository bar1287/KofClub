import { paymentLabel, stars, waitUntil } from './store';
import type { StarPayment } from './types';

const payment: StarPayment = {
  id: 'p',
  orderId: 'o',
  product: 'CLUB_PRO',
  clubId: 'c',
  userId: 'u',
  username: 'ann',
  stars: 250,
  recurring: true,
  subscriptionExpiresAt: null,
  paidAt: '2026-10-15T00:00:00Z',
  refundedAt: null,
  refundReason: null,
};

describe('store helpers', () => {
  it('formats prices and payments', () => {
    expect(stars(1000)).toBe('★ 1,000');
    expect(paymentLabel(payment)).toBe('Club Pro (renewal)');
    expect(paymentLabel({ ...payment, product: null, recurring: false })).toBe('Unmatched payment');
  });

  it('waits for the server to record a payment', async () => {
    let calls = 0;
    await expect(waitUntil(async () => ++calls === 3, 5, 1)).resolves.toBe(true);
    expect(calls).toBe(3);
    await expect(waitUntil(async () => false, 2, 1)).resolves.toBe(false);
    await expect(
      waitUntil(
        async () => {
          throw new Error('offline');
        },
        1,
        1,
      ),
    ).resolves.toBe(false);
  });
});
