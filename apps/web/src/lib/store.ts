import type { StarPayment, StoreProductId } from './types';

/** Short names for products in lists. */
export const PRODUCT_NAMES: Record<StoreProductId, string> = {
  CLUB_PRO: 'Club Pro',
  PREMIUM_THEMES: 'Premium themes',
  TIP_SMALL: 'Tip',
  TIP_MEDIUM: 'Tip',
  TIP_LARGE: 'Tip',
};

export const TIPS: readonly StoreProductId[] = ['TIP_SMALL', 'TIP_MEDIUM', 'TIP_LARGE'];

/** "★ 250" */
export function stars(n: number): string {
  return `★ ${n.toLocaleString('en-US')}`;
}

export function paymentLabel(p: StarPayment): string {
  const name = p.product ? PRODUCT_NAMES[p.product] : 'Unmatched payment';
  return p.recurring ? `${name} (renewal)` : name;
}

/**
 * Polls until `done` holds (Telegram reports the payment to our server a
 * moment after the invoice closes). Resolves false after `tries` attempts.
 */
export async function waitUntil(
  done: () => Promise<boolean>,
  tries = 10,
  delayMs = 1000,
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await done().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}
