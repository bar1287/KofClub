/**
 * Table look and feel (roadmap W1.6): kept in this browser, never sent to
 * the server. Every value is validated on load so a bad stored value falls
 * back to the default instead of breaking the page.
 */
export const FELTS = [
  'green',
  'blue',
  'red',
  'purple',
  'gray',
  'midnight',
  'royal',
  'emerald',
] as const;
export const CARD_BACKS = ['blue', 'red', 'black', 'gold', 'teal'] as const;
export const MOTIONS = ['auto', 'reduced'] as const;

export type Felt = (typeof FELTS)[number];
export type CardBack = (typeof CARD_BACKS)[number];
/** auto follows the system setting (prefers-reduced-motion). */
export type Motion = (typeof MOTIONS)[number];

export interface Prefs {
  sound: boolean;
  /** 0..1 */
  volume: number;
  fourColorDeck: boolean;
  felt: Felt;
  cardBack: CardBack;
  motion: Motion;
}

export const DEFAULT_PREFS: Prefs = {
  sound: true,
  volume: 0.6,
  fourColorDeck: false,
  felt: 'green',
  cardBack: 'blue',
  motion: 'auto',
};

export const PREFS_KEY = 'kofclub.prefs';

/**
 * Premium themes (T2, ADR-018): looks only, unlocked with Telegram Stars
 * where the store is on. Nothing changes in the game.
 */
export const PREMIUM_FELTS: readonly Felt[] = ['midnight', 'royal', 'emerald'];
export const PREMIUM_CARD_BACKS: readonly CardBack[] = ['gold', 'teal'];

export function isPremiumFelt(f: Felt): boolean {
  return PREMIUM_FELTS.includes(f);
}

export function isPremiumCardBack(b: CardBack): boolean {
  return PREMIUM_CARD_BACKS.includes(b);
}

/** What is shown without premium themes: premium choices fall back to the defaults. */
export function withoutPremium(prefs: Prefs): Prefs {
  return {
    ...prefs,
    felt: isPremiumFelt(prefs.felt) ? DEFAULT_PREFS.felt : prefs.felt,
    cardBack: isPremiumCardBack(prefs.cardBack) ? DEFAULT_PREFS.cardBack : prefs.cardBack,
  };
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** Turns anything (stored JSON, a partial patch) into valid preferences. */
export function sanitizePrefs(raw: unknown): Prefs {
  const v = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  const volume = typeof v.volume === 'number' && Number.isFinite(v.volume) ? v.volume : d.volume;
  return {
    sound: typeof v.sound === 'boolean' ? v.sound : d.sound,
    volume: Math.min(1, Math.max(0, volume)),
    fourColorDeck: typeof v.fourColorDeck === 'boolean' ? v.fourColorDeck : d.fourColorDeck,
    felt: oneOf(FELTS, v.felt, d.felt),
    cardBack: oneOf(CARD_BACKS, v.cardBack, d.cardBack),
    motion: oneOf(MOTIONS, v.motion, d.motion),
  };
}

export function loadPrefs(storage: Pick<Storage, 'getItem'> | null): Prefs {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    return sanitizePrefs(raw ? JSON.parse(raw) : {});
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(storage: Pick<Storage, 'setItem'> | null, prefs: Prefs): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: the choice lasts for this page */
  }
}

/** Data attributes on <html> that the stylesheet themes by. */
export function prefsAttributes(prefs: Prefs): Record<string, string> {
  return {
    'data-felt': prefs.felt,
    'data-card-back': prefs.cardBack,
    'data-four-color': String(prefs.fourColorDeck),
    'data-motion': prefs.motion,
  };
}
