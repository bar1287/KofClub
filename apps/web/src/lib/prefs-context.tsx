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
  loadPrefs,
  PREFS_KEY,
  prefsAttributes,
  savePrefs,
  sanitizePrefs,
  type Prefs,
} from './prefs';

interface PrefsHandle {
  prefs: Prefs;
  update(patch: Partial<Prefs>): void;
}

const PrefsContext = createContext<PrefsHandle>({ prefs: DEFAULT_PREFS, update: () => undefined });

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
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs(storage()));
  const current = useRef(prefs);

  useEffect(() => {
    current.current = prefs;
    const el = document.documentElement;
    for (const [name, value] of Object.entries(prefsAttributes(prefs))) {
      el.setAttribute(name, value);
    }
  }, [prefs]);

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

  const value = useMemo(() => ({ prefs, update }), [prefs, update]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsHandle {
  return useContext(PrefsContext);
}
