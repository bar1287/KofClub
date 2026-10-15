'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_PREFS,
  isPremiumCardBack,
  isPremiumFelt,
  loadPrefs,
  PREFS_KEY,
  prefsAttributes,
  savePrefs,
  sanitizePrefs,
  withoutPremium,
  type Prefs,
} from './prefs';
import { useSession } from './session';

interface PrefsHandle {
  prefs: Prefs;
  update(patch: Partial<Prefs>): void;
  /**
   * Premium themes are unlocked: bought with Stars, or free where the store
   * is off. Null until checked (see `checkPremium`).
   */
  premium: boolean | null;
  /** Asks the server (again, e.g. after a purchase). */
  checkPremium(): void;
}

const PrefsContext = createContext<PrefsHandle>({
  prefs: DEFAULT_PREFS,
  update: () => undefined,
  premium: null,
  checkPremium: () => undefined,
});

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Look-and-feel preferences for this browser (roadmap W1.6). They are
 * applied as data attributes on <html> (the stylesheet themes by them) and
 * follow changes made in other tabs.
 */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const { status, ep } = useSession();
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(storage()));
  const [premium, setPremium] = useState<boolean | null>(null);
  const current = useRef(prefs);

  const checkPremium = useCallback(() => {
    if (status !== 'authenticated') return;
    void Promise.all([ep.store(), ep.myStore()])
      .then(([catalog, mine]) =>
        setPremium(!catalog.enabled || mine.entitlements.includes('PREMIUM_THEMES')),
      )
      .catch(() => undefined);
  }, [status, ep]);

  // Only players who chose a premium theme need the check on every page.
  const wantsPremium = isPremiumFelt(prefs.felt) || isPremiumCardBack(prefs.cardBack);
  useEffect(() => {
    if (wantsPremium) checkPremium();
  }, [wantsPremium, checkPremium]);

  // Premium choices show only once unlocked (cosmetic, this browser only).
  const locked = premium === false || (premium === null && status === 'anonymous');
  const shown = useMemo(() => (locked ? withoutPremium(prefs) : prefs), [locked, prefs]);
  useEffect(() => {
    current.current = prefs;
    const el = document.documentElement;
    for (const [name, value] of Object.entries(prefsAttributes(shown))) {
      el.setAttribute(name, value);
    }
  }, [prefs, shown]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_KEY) setPrefs(loadPrefs(storage()));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((patch: Partial<Prefs>) => {
    const next = sanitizePrefs({ ...current.current, ...patch });
    current.current = next;
    savePrefs(storage(), next);
    setPrefs(next);
  }, []);

  const value = useMemo(
    () => ({ prefs, update, premium, checkPremium }),
    [prefs, update, premium, checkPremium],
  );
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsHandle {
  return useContext(PrefsContext);
}
