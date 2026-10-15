import type { AppConfig } from '../../config/config';

/**
 * What the Stars store sells (T2, ADR-018): digital goods that never touch
 * gameplay. Nothing here buys chips, seats, buy-ins, tournament entries or
 * prizes, and nothing a player wins can become Stars.
 */
export const PRODUCT_IDS = [
  'CLUB_PRO',
  'PREMIUM_THEMES',
  'TIP_SMALL',
  'TIP_MEDIUM',
  'TIP_LARGE',
] as const;
export type ProductId = (typeof PRODUCT_IDS)[number];

export const ENTITLEMENTS = ['PREMIUM_THEMES'] as const;
export type Entitlement = (typeof ENTITLEMENTS)[number];

/** Telegram allows exactly one subscription period: 30 days. */
export const SUBSCRIPTION_PERIOD_SECONDS = 2_592_000;

export interface Product {
  id: ProductId;
  kind: 'SUBSCRIPTION' | 'ONE_TIME' | 'TIP';
  /** Invoice title (Telegram: at most 32 characters). */
  title: string;
  /** Invoice description (Telegram: at most 255 characters). */
  description: string;
  stars: number;
  periodDays: number | null;
  /** What a one-time purchase grants. */
  entitlement: Entitlement | null;
}

const TIP_DESCRIPTION =
  'Say thanks to the people who build KofClub. A tip buys nothing in the app.';

/** The catalog with this deployment's prices and plan limits. */
export function catalog(config: AppConfig): Product[] {
  return [
    {
      id: 'CLUB_PRO',
      kind: 'SUBSCRIPTION',
      title: 'Club Pro (30 days)',
      description:
        `Up to ${config.CLUB_PRO_MAX_OPEN_TABLES} open tables and ` +
        `${config.CLUB_PRO_MAX_MEMBERS} members for your club, renewed monthly until you ` +
        'cancel. Chips stay free and nothing changes at the tables.',
      stars: config.STARS_PRICE_CLUB_PRO,
      periodDays: 30,
      entitlement: null,
    },
    {
      id: 'PREMIUM_THEMES',
      kind: 'ONE_TIME',
      title: 'Premium table themes',
      description:
        'Extra felts and card backs for how your tables look to you. Looks only: nothing ' +
        'changes in the game.',
      stars: config.STARS_PRICE_PREMIUM_THEMES,
      periodDays: null,
      entitlement: 'PREMIUM_THEMES',
    },
    tip('TIP_SMALL', 'Tip: a coffee', 50),
    tip('TIP_MEDIUM', 'Tip: a pizza', 250),
    tip('TIP_LARGE', 'Tip: a big thank you', 1000),
  ];
}

function tip(id: ProductId, title: string, stars: number): Product {
  return {
    id,
    kind: 'TIP',
    title,
    description: TIP_DESCRIPTION,
    stars,
    periodDays: null,
    entitlement: null,
  };
}

export function findProduct(config: AppConfig, id: ProductId): Product {
  const product = catalog(config).find((p) => p.id === id);
  if (!product) throw new Error(`unknown product ${id}`);
  return product;
}
