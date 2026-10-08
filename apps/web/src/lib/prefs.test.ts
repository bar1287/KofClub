import {
  DEFAULT_PREFS,
  loadPrefs,
  PREFS_KEY,
  prefsAttributes,
  sanitizePrefs,
  savePrefs,
} from './prefs';

describe('preferences', () => {
  it('fall back to defaults for missing or invalid values', () => {
    expect(sanitizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(
      sanitizePrefs({ sound: 'yes', volume: 7, felt: 'pink', cardBack: 'red', motion: 'reduced' }),
    ).toEqual({ ...DEFAULT_PREFS, volume: 1, cardBack: 'red', motion: 'reduced' });
    expect(sanitizePrefs({ volume: -2, fourColorDeck: true }).volume).toBe(0);
  });

  it('are stored in browser storage and survive bad data', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const prefs = { ...DEFAULT_PREFS, felt: 'blue' as const, fourColorDeck: true };
    savePrefs(storage, prefs);
    expect(loadPrefs(storage)).toEqual(prefs);
    store.set(PREFS_KEY, '{nope');
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadPrefs(throwing)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(throwing, prefs)).not.toThrow();
  });

  it('become data attributes for the stylesheet', () => {
    expect(prefsAttributes({ ...DEFAULT_PREFS, felt: 'gray', fourColorDeck: true })).toEqual({
      'data-felt': 'gray',
      'data-card-back': 'blue',
      'data-four-color': 'true',
      'data-motion': 'auto',
    });
  });
});
